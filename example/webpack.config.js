const path = require('path')
const PluginA = require('../plugins/cs-plugin')
module.exports = {
    mode: 'development',
    entry: {
        main: path.resolve(__dirname, './src/entry.js'),
    },
    context: process.cwd(),
    output: {
        path: path.resolve(__dirname, './build'),
        filename: '[name].js',
    },
    plugins: [new PluginA()],
    resolve: {
        extensions: ['.js', '.ts'],
    },
    module: {
        rules: [
        {
            test: /\.js/,
            use: [
                // 使用自己loader有三种方式 这里仅仅是一种
                path.resolve(__dirname, '../loaders/cs-loader/index.js'),
            ],
        },
        ],
    },
}