const path = require('path');
const fs = require('fs');
const { SyncHook } = require('tapable');
const { toUnixPath, tryExtensions, getSourceCode } = require('./utils')
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

class Compiler {
    constructor(options){
        this.options = options;
        this.rootPath = this.options.context || toUnixPath(process.cwd());
        this.hooks = {
            run: new SyncHook(),
            emit: new SyncHook(),
            done: new SyncHook()
        }
        // 保存所有入口模块对象
        this.entries = new Set()
        // 保存所有依赖模块对象
        this.modules = new Set()
        // 保存所有代码对象
        this.chunks = new Set()
        // 保存所有产出文件对象
        this.assets = new Map()
        // 保存所有文件对象
        this.files = new Set()
    }
    
    run(callback) {
        this.hooks.run.call()
        const entry = this.getEntry()
        // 编译入口文件
        this.buildEntryModule(entry)
        // 导出文件
        this.exportFile(callback);
    }
    getEntry() {
        let entry = Object.create(null);
        let { entry: optionEntry } = this.options
        if(typeof optionEntry === 'string'){
            entry['main'] = optionEntry
        } else {
            entry = optionEntry;
        }

        Object.keys(entry).forEach((key) => {
            const value = entry[key]
            if(!path.isAbsolute(value)){
                entry[key] = toUnixPath(path.join(this.rootPath, value));
            }
        })

        return entry
    }
    buildEntryModule(entry){
        Object.keys(entry).forEach((entryName) => {
            const entryPath = entry[entryName]
            const entryObj = this.buildModule(entryName, entryPath)
            this.entries.add(entryObj)
            this.buildUpChunk(entryName, entryObj);
        })
    }

    buildModule(moduleName,modulePath){
        // 1. 读取文件原始代码
        this.originSourceCode = fs.readFileSync(modulePath, 'utf-8')
        this.moduleCode = this.originSourceCode
        // 执行loader
        this.handleLoader(modulePath)
        // 开始编译
        const module = this.handleWebpackCompiler(moduleName, modulePath);
        return module
    }

    handleLoader(modulePath) {
        const matchLoaders = []
        // 1. 获取所有传入的loader规则
        const rules = this.options.module.rules
        rules.forEach((loader) => {
            if(loader.test.test(modulePath)){
                if (loader.loader) {
                    // 仅考虑loader { test:/\.js$/g, use:['babel-loader'] }, { test:/\.js$/, loader:'babel-loader' }
                    matchLoaders.push(loader.loader);
                  } else {
                    matchLoaders.push(...loader.use);
                  }
            }
        })

        // 倒序执行loader
        for (let index = matchLoaders.length-1; index > -1; index--) {
            const loaderFn = require(matchLoaders[index])
            this.moduleCode = loaderFn(this.moduleCode);
        }
    }

    // 编译文件
    handleWebpackCompiler(moduleName, modulePath) {
        // 将当前模块相对于项目启动根目录计算出相对路径 作为模块ID
        const moduleId = './' + path.posix.relative(this.rootPath, modulePath);
        // 创建模块对象
        const module = {
            id: moduleId,
            dependencies: new Set(), // 该模块所依赖模块绝对路径地址
            name: [moduleName], // 该模块所属的入口文件
        };
        // 调用babel分析我们的代码
        const ast = parser.parse(this.moduleCode, {
            sourceType: 'module',
        });

        // 深度优先 遍历语法Tree
        traverse(ast, {
            // 当遇到require语句时
            CallExpression:(nodePath) => {
              const node = nodePath.node;
              if (node.callee.name === 'require') {
                // 获得源代码中引入模块相对路径
                const requirePath = node.arguments[0].value;
                // 寻找模块绝对路径 当前模块路径+require()对应相对路径
                
                const moduleDirName = path.dirname(modulePath);
                const absolutePath = tryExtensions(
                  path.join(moduleDirName, requirePath),
                  this.options.resolve.extensions,
                  requirePath,
                  moduleDirName
                );
                // 生成moduleId - 针对于跟路径的模块ID 添加进入新的依赖模块路径
                const moduleId =
                  './' + path.relative(this.rootPath, absolutePath);
                // 通过babel修改源代码中的require变成__webpack_require__语句
                node.callee = t.identifier('__webpack_require__');
                // 修改源代码中require语句引入的模块 全部修改变为相对于跟路径来处理
                node.arguments = [t.stringLiteral(moduleId)];
                // 为当前模块添加require语句造成的依赖(内容为相对于根路径的模块ID)
                module.dependencies.add(moduleId);
              }
            },
          });
        // 遍历结束根据AST生成新的代码
        const { code } = generator(ast);
        // 为当前模块挂载新的生成的代码
        module._source = code;
        // 循环处理依赖文件
        module.dependencies.forEach((dependency) => {
            const depModule = this.buildModule(moduleName, dependency)
            this.modules.add(depModule)
        })
        return module
    }
    // 划分chunk
    buildUpChunk(entryName, entryObj){
        const chunk = {
            name: entryName, // 每一个入口文件作为一个chunk
            entryModule: entryObj, // entry编译后的对象
            modules: Array.from(this.modules).filter((i) =>
              i.name.includes(entryName)
            ), // 寻找与当前entry有关的所有module
        }
        this.chunks.add(chunk)
    }
    // 导出文件
    exportFile(callback){
        const output = this.options.output;
        // 根据chunks生成assets内容
        this.chunks.forEach((chunk) => {
            const parseFileName = output.filename.replace('[name]', chunk.name);
            // assets中 { 'main.js': '生成的字符串代码...' }
            this.assets.set(parseFileName, getSourceCode(chunk));
        })
        // 调用Plugin emit钩子
        this.hooks.emit.call();
        // 先判断目录是否存在 存在直接fs.write 不存在则首先创建
        if (!fs.existsSync(output.path)) {
            fs.mkdirSync(output.path);
        }
        // files中保存所有的生成文件名
        this.files = this.assets.keys(this.assets);
        // 将assets中的内容生成打包文件 写入文件系统中
        for (let fileName of this.files) {
            const filePath = path.join(output.path, fileName);
            fs.writeFileSync(filePath, this.assets.get(fileName));
        }
        // 结束之后触发钩子
        this.hooks.done.call();
        callback(null, {
            toJson: () => {
                return {
                entries: this.entries,
                modules: this.modules,
                files: this.files,
                chunks: this.chunks,
                assets: this.assets,
                };
            },
        });
    }
}

module.exports = Compiler