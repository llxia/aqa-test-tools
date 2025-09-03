import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { json } from 'express';
import { randomUUID } from 'crypto';

export class CustomMcpServer {
    serverInfo;
    options;
    port;
    constructor(serverInfo, options, port) {
        this.serverInfo = serverInfo;
        this.options = options;
        this.port = port;

        this.app.use(json());
        this.app.use(
            cors({
                origin: '*',
                methods: ['GET', 'PUT', 'POST'],
                exposedHeaders: ['Mcp-Session-Id'],
                allowedHeaders: [
                    'Content-Type',
                    'mcp-session-id',
                    'mcp-protocol-version',
                    'authorization',
                ],
            })
        );

        // Handle GET requests for server-to-client notifications via SSE
        this.app.get('/mcp', this.handleSessionRequest);

        // Handle POST requests for client-to-server communication
        this.app.post('/mcp', this.handlePostRequest);

        // Handle DELETE requests for session termination
        this.app.delete('/mcp', this.handleSessionRequest);

        this.app.listen(this.port);

        process.on('SIGINT', () => {
            console.log('Shutting down server from SIGINT');
            server.close();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.log('Shutting down server from SIGTERM');
            server.close((err) => {
                if (err) {
                    console.error(err);
                    process.exit(1);
                }
                process.exit(0);
            });
            setTimeout(() => {
                process.exit(1);
            }, 1 * 1000);
        });
    }
    app = express();

    // Map to store transports by session ID
    transports = {};

    // Handle POST requests for client-to-server communication
    handlePostRequest = async (req, res) => {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'];
        let transport;

        if (sessionId && this.transports[sessionId]) {
            // Reuse existing transport
            transport = this.transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
            // New initialization request
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sessionId) => {
                    // Store the transport by session ID
                    this.transports[sessionId] = transport;
                },
            });

            // Clean up transport when closed
            transport.onclose = () => {
                if (transport.sessionId) {
                    delete this.transports[transport.sessionId];
                }
            };
            const server = new McpServer(this.serverInfo, this.options);
            this.onNewSessionCallback?.(server, sessionId);

            // Connect to the MCP server
            await server.connect(transport);
        } else {
            // Invalid request
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided',
                },
                id: null,
            });
            return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
    };
    // Reusable handler for GET and DELETE requests
    handleSessionRequest = async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (!sessionId || !this.transports[sessionId]) {
            res.status(400).send('Invalid or missing session ID');
            return;
        }

        const transport = this.transports[sessionId];
        await transport.handleRequest(req, res);
    };

    onNewSession(callback) {
        this.onNewSessionCallback = callback;
    }
}
