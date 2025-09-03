import { CustomMcpServer } from './CustomMcpServer';
import { z } from 'zod';

const server = new CustomMcpServer(
    {
        name: 'name',
        version: '1.0.0',
    },
    {},
    3000
);

server.onNewSession((server) => {
    server.registerTool(
        'getTotals',
        {
            title: 'getTotals trss build',
            description: '',
            inputSchema: { build: z.string() },
        },
        async ({ build }) => {
            const data = await fetch(
                'https://trssrtp1.fyre.ibm.com/api/getTotals?id=68acbf59a4f6496f7f20f5ef',
                {
                    method: 'GET',
                }
            ).then((res) => res.json());
            return {
                content: [{ type: 'text', text: JSON.stringify(data) }],
            };
        }
    );
    server.registerTool(
        'getTestOutput',
        {
            title: 'get failed test output from TRSS',
            description: '',
            inputSchema: { build: z.string() },
        },
        async ({ build }) => {
            const data = await fetch(
                //
                //68acede3a4f6496f7f21a527
                'https://trssrtp1.fyre.ibm.com/api/getOutputById?id=68ad00436f7068eb9a59d6ee',
                {
                    method: 'GET',
                }
            ).then((res) => res.json());
            return {
                content: [{ type: 'text', text: JSON.stringify(data) }],
            };
        }
    );

    server.registerTool(
        'search',
        {
            title: 'search git repo with test name',
            description:
                'Input: test name. Output: list of git issue number and issue title that contains this test and < 6 months old.',
            inputSchema: { testName: z.string().describe('the test name') },
        },
        async ({ testName }) => {
            const generalTestName = testName.replace(/_\d+$/, '');

            // // fetch test output content
            // const info = await fetchData(
            //     `https://trssrtp1.fyre.ibm.com/api/getTestByTestName?testName=${testName}&buildNames=${buildName} `,
            //     {
            //         method: 'get',
            //     }
            // );

            // const result = await fetchData(
            //     `/api/getOutputById?id=${info.testOutputId}`,
            //     {
            //         method: 'get',
            //     }
            // );

            // const testOutput = result.output;

            // fetch related issues with Github API
            const response = await fetch(
                `https://api.github.com/search/issues?q=${generalTestName}+repo:eclipse-openj9/openj9`,
                {
                    method: 'get',
                }
            ).then((res) => res.json());
            // const relatedIssues = await response.json();
            // let result = '';
            // const oldDate = new Date();
            // oldDate.setMonth(oldDate.getMonth() - 6);
            // for (let index = 0; index < relatedIssues.items.length; index++) {
            //     const createdAt = new Date(
            //         relatedIssues.items[index].created_at
            //     );
            //     // const state = relatedIssues.items[index].state;
            //     if (createdAt < oldDate) {
            //         continue;
            //     }
            //     result +=
            //         relatedIssues.items[index].number +
            //         ' : ' +
            //         relatedIssues.items[index].title +
            //         '\n';
            // }
            return {
                content: [{ type: 'text', text: JSON.stringify(response) }],
            };
        }
    );
});
