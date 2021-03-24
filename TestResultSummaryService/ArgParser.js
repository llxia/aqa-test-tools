const fs = require('fs');
const { logger } = require('./Utils');
let _config;

const parse = () => {
    for (let i = 0; i < process.argv.length; i++) {
        let argv = process.argv[i];
        if (argv.startsWith('--configFile=')) {
            const file = argv.substring(argv.indexOf('=') + 1);
            if (fs.existsSync(file)) {
                _config = require(file);
            } else {
                logger.warn("Cannot find the config file: ", argv);
            }
        }
    }
}

const getConfig = () => {
    return _config;
}

const getConfigDB = () => {
    if (_config && _config.DB && _config.DB.user && _config.DB.password) {
        return _config.DB;
    }
    return null;
}

module.exports = { parse, getConfig, getConfigDB };