import config from 'config';
import * as golos from 'golos-classic-js';

delete process.env.BROWSER;

const path = require('path');
const ROOT = path.join(__dirname, '..');

// Tell `require` calls to look into `/app` also
// it will avoid `../../../../../` require strings
process.env.NODE_PATH = path.resolve(__dirname, '..');
require('module').Module._initPaths();

global.$STM_Config = {
    ws_connection_client: config.get('ws_connection_client'),
    img_proxy_prefix: config.get('img_proxy_prefix'),
    read_only_mode: config.get('read_only_mode'),
    registrar_fee: config.get('registrar.fee'),
    upload_image: config.get('upload_image'),
    site_domain: config.get('site_domain'),
    google_analytics_id: config.get('google_analytics_id'),
    chain_id: config.get('chain_id'),
    ads_per_post: config.get('ads_per_post'),
    elastic_search: config.get('elastic_search')
};

const WebpackIsomorphicTools = require('webpack-isomorphic-tools');
global.webpackIsomorphicTools = new WebpackIsomorphicTools(require('../webpack/webpack-isotools-config'));

global.webpackIsomorphicTools.server(ROOT, () => {
    golos.config.set('websocket', config.get('ws_connection_server'))
    golos.config.set('chain_id', config.get('chain_id'))

    try {
        require('./server');
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
});
