# webpack核心原理分析
背景：目前前端工程化的主要工具就webpack，主要是用来构建打包项目，虽然再项目体量大了，打包时间会被诟病，但是这也不影响他的强大。今天我们一起来手写一个核心的简易的webpack

## 流程分析
整个打包流程大概可以分为以下步骤  
**合并配置** ——> **入口编译** ——> **依赖编译** ——> **完成编译** ——> **输出文件**

## 合并配置
> 合并配置主要是就是将用户自定义的或者通过命令方式传入的参数和默认参数进行整合  
> process.argv.slice(2) 获取命令方式传参
```js
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
```

## 入口编译
> 编译入口文件也就是entry传入的文件

```js
buildEntryModule(entry){
    Object.keys(entry).forEach((entryName) => {
        const entryPath = entry[entryName]
        const entryObj = this.buildModule(entryName, entryPath)
        this.entries.add(entryObj)
        this.buildUpChunk(entryName, entryObj);
    })
}
```

> 由于依赖编译核心逻辑是一样的，所以新增buildModule函数统一管理

```js
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
```

> 通过babel的AST语法树转换require引入问题,返回一个module对象

```js
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
```

## 依赖编译

> 由于可能在文件中引入其他文件，那么其他文件也需要打包，这是一个递归操作 

```js
// 循环处理依赖文件(handleWebpackCompiler方法里面)
module.dependencies.forEach((dependency) => {
    const depModule = this.buildModule(moduleName, dependency)
    this.modules.add(depModule)
})    
```

## 编译完成

> 编译完成后module需要按入口文件进行模块划分，也就是chunks

```js
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
```


## 文件生成

> 根据chunk生成对应的打包后文件

```js
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
```

> getSourceCode 方法主要是一个模板写入一些动态字符串然后返回字符串，这一步可以查看webpack打包后文件，删除一些其他的，只是保留核心逻辑

```js
function getSourceCode(chunk) {
  const { name, entryModule, modules } = chunk;
  return `
  (() => {
    var __webpack_modules__ = {
      ${modules
        .map((module) => {
          return `
          '${module.id}': (module) => {
            ${module._source}
      }
        `;
        })
        .join(',')}
    };
    // The module cache
    var __webpack_module_cache__ = {};

    // The require function
    function __webpack_require__(moduleId) {
      // Check if module is in cache
      var cachedModule = __webpack_module_cache__[moduleId];
      if (cachedModule !== undefined) {
        return cachedModule.exports;
      }
      // Create a new module (and put it into the cache)
      var module = (__webpack_module_cache__[moduleId] = {
        // no module.id needed
        // no module.loaded needed
        exports: {},
      });

      // Execute the module function
      __webpack_modules__[moduleId](module, module.exports, __webpack_require__);

      // Return the exports of the module
      return module.exports;
    }

    var __webpack_exports__ = {};
    // This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
    (() => {
      ${entryModule._source}
    })();
  })();
  `;
}
```