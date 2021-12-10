const Compiler = require('./compiler')

function webpack(options) {
    const mergeOptions = _mergeOptions(options)
    const compiler = new Compiler(mergeOptions)
    // 加载插件
    _loadPlugin(options.plugins, compiler)
    return compiler
}

function _mergeOptions(options){
    const shellOptions = process.argv.slice(2).reduce((option, argv) => {
    // argv -> --mode=production
    const [key, value] = argv.split('=');
    if (key && value) {
        const parseKey = key.slice(2);
        option[parseKey] = value;
    }
    return option;
    }, {});
    return { ...options, ...shellOptions };
}


// 加载插件函数
function _loadPlugin(plugins, compiler){
    if (plugins && Array.isArray(plugins)) {
        plugins.forEach((plugin) => {
            plugin.apply(compiler)
        })
    }
}

module.exports = webpack