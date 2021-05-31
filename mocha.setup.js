require('babel-register')();
const Enzyme = require('enzyme');
const Adapter = require('enzyme-adapter-react-16');

process.env.NODE_PATH = require('path').resolve(__dirname, '.');
require('module').Module._initPaths();

const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const exposedProperties = ['window', 'navigator', 'document'];

global.document = (new JSDOM('')).window.document;
global.$GLS_Config = {currency: 'USD'}
global.window = document.defaultView;

Object.keys(document.defaultView).forEach((property) => {
    if (typeof global[property] === 'undefined') {
        exposedProperties.push(property);
        global[property] = document.defaultView[property];
    }
});

global.navigator = {
    userAgent: 'node.js'
};

documentRef = document;

function donothing() {
    return null;
}
require.extensions['.svg'] = donothing;
require.extensions['.css'] = donothing;
require.extensions['.scss'] = donothing;

Enzyme.configure({ adapter: new Adapter() });
