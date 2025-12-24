require('@testing-library/jest-dom');

// Add TextEncoder/TextDecoder polyfills for react-router-dom
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;