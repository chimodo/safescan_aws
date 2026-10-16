// Lets the app import the URL normalization, heuristics and verdict rules in ../shared,
// the same modules the AWS Lambda uses.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')];

module.exports = config;
