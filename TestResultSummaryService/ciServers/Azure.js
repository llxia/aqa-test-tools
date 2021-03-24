const Promise = require('bluebird');
const azdev = require("azure-devops-node-api");
// import * as ba from "azure-devops-node-api/BuildApi";
//import * as bi from "azure-devops-node-api/interfaces/BuildInterfaces";
const { logger, getParams } = require('../Utils');
const ArgParser = require("../ArgParser");
const CIServer = require('./CIServer');

const fs = require('fs');

const options = { request: { timeout: 2000 } };

// Server connection may drop. If timeout, retry.
const retry = fn => {
    const promise = Promise.promisify(fn);
    return async function () {
        for (let i = 0; i < 5; i++) {
            try {
                return await promise.apply(null, arguments);
            } catch (e) {
                logger.warn(`Try #${i + 1}: connection issue`, arguments);
                logger.warn(e);
                if (e.toString().includes("unexpected status code: 404")) {
                    return { code: 404 };
                }
            }
        }
    }
}


// match Azure BuildResult to TRSS build result
// For Azure code, please check azure-devops-node-api/interfaces/BuildInterfaces.d.ts
const buildResult = {
    0: null,  // None
    2: "SUCCESS",
    4: "FAILURE",  // PartiallySucceeded
    8: "FAILURE",
    32: "ABORT"  // Canceled
};

// match Azure BuildResult to TRSS build result
const state = {
    0: "Pending",
    1: "InProgress",
    2: "Completed"
};


/**
 * definition === build name
 * 

 */
class Azure extends CIServer {

    constructor(options) {
        super(options);
        this.credentails = ArgParser.getConfig();
    }

    // Assumming if it is not azure, it is Jenkins
    static matchServer(buildUrl) {
        return buildUrl.match(/dev.azure.com/);
    }



    /**
     * 
     * @param {*} url 
     * @param {*} definitionId is the term in Adzure. In TRSS, it is the same as buildName in Jenkins
     * In Azure, buildNumber is a string. (i.e., OpenJDK8U-jdk_x64_mac_hotspot_2020-04-01-18-33)
     * @return [] [{duration, id, result, timestamp}, ...]
     * duration = finishTime - startTime
     * result: SUCCESS === 2
     * timestamp = startTime
     * N
id: "1869",
result: "SUCCESS",
timestamp: 1584734443756
     */
    async getAllBuilds(url, definition) {
        // your collection url
        // const orgUrl = "https://dev.azure.com/adoptopenjdk";

        // const token = "token value";

        const { projectName, orgUrl } = this.getProjectInfo(url);
        const token = this.getToken(url);
        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(orgUrl, authHandler);

        const buildApi = await connection.getBuildApi();
        const builds = await buildApi.getBuilds(projectName, [definition]);
        // console.log("getAllBuilds builds", builds)
        return this.formatData(builds, true, url);
    }

    streamToString(stream) {
        const chunks = []
        return new Promise((resolve, reject) => {
            stream.on('data', chunk => chunks.push(chunk))
            stream.on('error', reject)
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        })
    }

    async getBuildOutput(task) {
        const { url, buildNum, azure } = task;
        // TODO
        // azure is empty? why?
        if (!azure) console.log("getBuildOutput there is no azure", task);
        if (azure && azure.log && azure.log.id) {
            const { orgUrl, projectName } = this.getProjectInfo(url);
            const buildApi = await this.getBuildApi(orgUrl, projectName);
            console.log("getBuildOutput ", projectName, buildNum, azure);
            const output = await buildApi.getBuildLog(projectName, buildNum, azure.log.id);
            return await this.streamToString(output);
        }
        return null;
    }

    async getBuildInfo(task) {
        const { url, buildNum, subId } = task;
        // const token = this.getToken(url);
        // const { projectName, orgUrl } = this.getProjectInfo(url);
        // const authHandler = azdev.getPersonalAccessTokenHandler(token);
        // const connection = new azdev.WebApi(orgUrl, authHandler);

        // const buildApi = await connection.getBuildApi();
        // const timeline = await buildApi.getBuildTimeline(projectName, buildNum);
        const records = await this.getTimelineRecords(url, buildNum);
        // console.log("***************getTimelineRecords records", url, buildNum, records.length);
        for (let rec of records) {
            if (rec.id === subId) {
                return this.formatData([rec], true);
            }
        };
        return null;
    }

    formatData(data, setBuildNum = false, url) {
        return data.map(d => {
            let buildUrl = url;
            if (d._links) {
                buildUrl = d._links.web.href;
            } else if (d.url) {
                buildUrl = d.url;
            } else if (d.log) {
                buildUrl = d.log.url;
            }
            return {
                buildUrl,
                buildNum: setBuildNum ? d.id : null,
                result: d.result ? buildResult[d.result] : null,
                buildNameStr: d.buildNumber ? d.buildNumber : d.name,
                duration: (d.startTime && d.finishTime) ? d.finishTime.getTime() - d.startTime.getTime() : null,
                timestamp: d.startTime ? d.startTime.getTime() : null,
                building: d.state !== 2 ? true : null,
                subId: d.id,
                azure: d
            };
        });
    }

    async getTimelineRecords(url, buildNum) {
        const { orgUrl, projectName } = this.getProjectInfo(url);
        const buildApi = await this.getBuildApi(orgUrl, projectName);

        const timeline = await buildApi.getBuildTimeline(projectName, buildNum);
        if (timeline) {
            return this.formatData(timeline.records);
        }
        return null;
    }

    // async getLastBuildInfo(url, buildName) {
    //     const newUrl = this.addCredential(url);
    //     const jenkins = jenkinsapi.init(newUrl, options);
    //     const last_build_info = retry(jenkins.last_build_info);
    //     const body = await last_build_info(buildName);
    //     return body;
    // }

    getBuildParams(buildInfo) {
        return null;
    }


    // set definitionId as buildName
    // https://dev.azure.com/adoptopenjdk/AdoptOpenJDK/_build?definitionId=3&_a=summary
    getBuildInfoByUrl(buildUrl) {
        let tokens = buildUrl.split("?");
        let buildName = null;
        let url = null;
        if (tokens && tokens.length === 2) {
            url = tokens[0].replace(/\/_build/, "");
            const paramsStr = tokens[1];
            const paramsObj = getParams(paramsStr);
            if (paramsObj && paramsObj.definitionId) {
                buildName = paramsObj.definitionId;
            }
        }
        return { buildName, url };
    }

    getToken(url) {
        let token = null;
        if (this.credentails && this.credentails.hasOwnProperty(url)) {
            token = encodeURIComponent(this.credentails[url].password);
        }
        return token;
    }

    getProjectInfo(url) {
        //split based on / and project name should be the last element
        let projectName = null;
        let orgUrl = null;
        let tokens = url.split("/");
        if (tokens && tokens.length > 1) {
            projectName = tokens.pop();
            orgUrl = url.replace(`/${projectName}`, "");
        }
        return { projectName, orgUrl };
    }

    async getBuildApi(url) {
        const token = this.getToken(url);
        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(url, authHandler);

        return await connection.getBuildApi();
    }

}

module.exports = Azure;