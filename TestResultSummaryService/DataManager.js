const { TestResultsDB, OutputDB, AuditLogsDB } = require( './Database' );
const ObjectID = require( 'mongodb' ).ObjectID;
const Parsers = require( `./parsers/` );
const DefaultParser = require( `./parsers/Default` );
const { logger } = require( './Utils' );

class DataManager {
    findParserType( buildName, output ) {
        const keys = Object.keys( Parsers );
        for ( let i = 0; i < keys.length; i++ ) {
            const type = keys[i];
            if ( Parsers[type].canParse( buildName, output ) ) {
                return type;
            }
        }
    }

    async parseOutput( buildName, output ) {
        let parserType = this.findParserType( buildName, output );
        let parser;
        if ( parserType ) {
            parser = new Parsers[parserType]( buildName );
        } else {
            parser = new DefaultParser();
            parserType = "Default";
        }
        const obj = await parser.parse( output );
        return { parserType, ...obj };
    }

    async updateOutput( data ) {
        let { id, output } = data;
        const outputDB = new OutputDB();

        //Due to 16M document size limit, only store last ~12M output
        const size = 12 * 1024 * 1024;
        if (output && output.length > size) {
            output = output.substr(-size);
        }
        if ( id ) {
            const result = await outputDB.update( { _id: new ObjectID( id ) }, { $set: { output } } );
            return id;
        } else {
            const status = await outputDB.populateDB( { output } );
            if ( status && status.insertedCount === 1 ) {
                return status.insertedIds[0];
            }
        }
        return -1;
    }

    async updateBuild( data ) {
        logger.verbose( "updateBuild", data );
        const { _id, buildName, ...newData } = data;
        const criteria = { _id: new ObjectID( _id ) };
        const testResults = new TestResultsDB();
        const result = await testResults.update( criteria, { $set: newData } );
    }

    async updateBuildWithOutput(data) {
        logger.verbose("updateBuildWithOutput", data.buildName, data.buildNum);
        const { _id, buildName, output, rootBuildId, ...newData } = data;
        const criteria = { _id: new ObjectID(_id) };
        const { builds, tests, build, ...value } = await this.parseOutput(buildName, output);
        const testResults = new TestResultsDB();
        const outputDB = new OutputDB();
        let update = {
            ...newData,
            ...value
        };
        if (!rootBuildId) {
            const rootBuildId = await testResults.getRootBuildId(_id);
            update.rootBuildId = new ObjectID(rootBuildId);
        }
        if ( builds && builds.length > 0 ) {
            let commonUrls = data.url.split("/job/")[0];
            commonUrls = commonUrls.split("/view/")[0];
            await Promise.all(builds.map( async b => {
                const childBuild = {
                    url: commonUrls + b.url,
                    buildName: b.buildName,
                    buildNameStr: b.buildNameStr,
                    buildNum: parseInt( b.buildNum, 10 ),
                    rootBuildId: rootBuildId ? rootBuildId : update.rootBuildId,
                    parentId: _id,
                    type: b.type,
                    status: "NotDone"
                };
                const id = await this.createBuild( childBuild );
                await new AuditLogsDB().insertAuditLogs({
                    _id : id,
                    url: commonUrls + b.url,
                    buildName: b.buildName,
                    buildNum: b.buildNum,
                    status: "NotDone",
                    action: "[createBuild]"
                });
            } ));

            const outputData = {
                id: data.buildOutputId ? data.buildOutputId : null,
                output,
            };
            // store output
            const outputId = await this.updateOutput( outputData );
            if ( !data.buildOutputId && outputId !== -1 ) {
                update.buildOutputId = outputId;
            }
            update.hasChildren = true;
        } else if ( tests && tests.length > 0 ) {
            const testsObj = await Promise.all( tests.map( async ( { testOutput, ...test } ) => {
                let testOutputId = null;
                if ( testOutput ) {
                    const outputData = {
                        id: null,
                        output: testOutput,
                    };
                    // store output
                    testOutputId = await this.updateOutput( outputData );
                }
                return {
                    _id: new ObjectID(),
                    testOutputId,
                    ...test
                };
            } ) );
            update.tests = testsObj;
            update.hasChildren = false;
        } else if ( build === null ) {
            const buildOutputId = await this.updateOutput( { id: null, output } );
            update.buildOutputId = buildOutputId;
            update.hasChildren = false;
        }
        const result = await testResults.update( criteria, { $set: update } );
    }

    // create build only if the build does not exist in database
    async createBuild( data ) {
        const { url, buildName, buildNum } = data;
        let query = { url, buildName, buildNum };

        if (data.subId) {
            query.subId = data.subId;
        }

        const testResults = new TestResultsDB();
        const result = await testResults.getData( query ).toArray();
        if ( result && result.length === 0 ) {
            const status = await testResults.populateDB( data );
            if ( status && status.insertedCount === 1 ) {
                logger.debug( "createBuild", data.buildName, data.buildNum, query.subId ? data.subId : "" );
                return status.insertedIds[0];
            }
            return -1;
        }
    }
}

module.exports = DataManager;