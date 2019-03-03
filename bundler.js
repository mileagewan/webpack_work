const fs = require("fs");
const path = require("path");
const babylon = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const babel = require("@babel/core");

let ID = 0;

// 读取文件信息，并获得当前js文件的依赖关系
function createAsset(filename) {
  //获取文件，返回值是字符串
  const content = fs.readFileSync(filename, "utf-8");

  // 讲字符串为ast（抽象语法树， 这个是编译原理的知识，说得简单一点就是，可以把js文件里的代码抽象成一个对象，代码的信息会存在对象中）
  //babylon 这个工具是是负责解析字符串并生产ast。
  const ast = babylon.parse(content, {
    sourceType: "module"
  });

  //用来存储 文件所依赖的模块，简单来说就是，当前js文件 import 了哪些文件，都会保存在这个数组里
  const dependencies = [];

  // 遍历当前抽象语法树
  traverse(ast, {
    // 每当遍历到import语法的时候
    ImportDeclaration: ({ node }) => {
      // 把当前依赖的模块加入到数组中，其实这存的是字符串，
      //例如 如果当前js文件 有一句 import message from './message.js'， 
      //'./message.js' === node.source.value
      dependencies.push(node.source.value);
    }
  });

  //模块的id 从0开始， 相当一个js文件 可以看成一个模块
  const id = ID++;

  // 这边主要把ES6 的代码转成 ES5
  const { code } = babel.transformFromAstSync(ast, null, {
    presets: ["@babel/preset-env"]
  });

  return {
    id,
    filename,
    dependencies,
    code
  };
}

// 从入口开始分析所有依赖项，形成依赖图，采用广度遍历
function createGraph(entry) {
  const mainAsset = createAsset(entry);
    
  // 定义一个保存依赖项的数组
  const queue = [mainAsset];

  for (const asset of queue) {
    const dirname = path.dirname(asset.filename);

    // 定义一个保存子依赖项的属性
    asset.mapping = {};

    asset.dependencies.forEach(relativePath => {
      const absolutePath = path.join(dirname, relativePath);
        
      // 获得子依赖（子模块）的依赖项、代码、模块id，文件名
      const child = createAsset(absolutePath);

      // 给子依赖项赋值，
      asset.mapping[relativePath] = child.id;

      // 将子依赖也加入队列中，广度遍历
      queue.push(child);
    });
  }
  return queue;
}

// 根据生成的依赖关系图，生成浏览器可执行文件
function bundle(graph) {
  let modules = "";

  // 把每个模块中的代码放在一个function作用域内
  graph.forEach(mod => {
    modules += `${mod.id}:[
      function (require, module, exports){
        ${mod.code}
      },
      ${JSON.stringify(mod.mapping)},
    ],`;
  });

  // require, module, exports 是 cjs的标准不能再浏览器中直接使用，所以模拟了模块加载，执行，导出操作。
  const result = `
    (function(modules){
      // 创建一个require()函数: 它接受一个 模块ID 并在我们之前构建的模块对象查找它.
      function require(id){
        const [fn, mapping] = modules[id];
        function localRequire(relativePath){
          // 根据mapping的路径，找到对应的模块id
          return require(mapping[relativePath]);
        }
        const module = {exports:{}};
        // 执行每个模块的代码。
        fn(localRequire,module,module.exports);
        return module.exports;
      }
      // 执行入口文件，
      require(0);
    })({${modules}})
  `;

  return result;
}

const graph = createGraph("./example/entry.js");
const result = bundle(graph);

// 打包生成文件
fs.writeFileSync("./bundle.js", result);