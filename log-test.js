const express = require("express");
const multer = require("multer");
const app = express();
const PORT = 3002;

// 允许所有跨域
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

// 根路径
app.get("/", (req, res) => {
  console.log(" 根路径访问");
  res.json({ message: "测试后端", time: new Date().toISOString() });
});

// 上传接口 - 最简单的实现
const upload = multer();
app.post("/api/check/ai", upload.single("file"), (req, res) => {
  console.log(" 收到上传请求!");
  console.log("文件名:", req.file?.originalname || "无");
  console.log("文件大小:", req.file?.size || 0);
  console.log("请求头:", JSON.stringify(req.headers, null, 2));
  
  res.json({
    received: true,
    name: req.file?.originalname,
    size: req.file?.size,
    timestamp: new Date().toISOString()
  });
});

// 404
app.use((req, res) => {
  console.log(` 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "未找到" });
});

app.listen(PORT, () => {
  console.log(`\n 日志测试后端启动: http://localhost:${PORT}`);
  console.log("等待请求...\n");
});
