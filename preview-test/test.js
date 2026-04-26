// JavaScript 测试文件

class PreviewTest {
  constructor(name) {
    this.name = name;
    this.createdAt = new Date();
  }

  greet() {
    console.log(`Hello, ${this.name}!`);
    return this;
  }

  static create(name) {
    return new PreviewTest(name);
  }
}

// 使用示例
const test = PreviewTest.create('SVG Preview');
test.greet();

// 导出模块
export default PreviewTest;
