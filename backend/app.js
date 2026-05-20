const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { exec } = require("child_process");
const WordExtractor = require("word-extractor");
const axios = require("axios"); // 引入axios
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3002;

// ========== 中间件配置 ==========
app.use(cors({
  origin: true, // 允许所有来源（包括局域网 IP），例如：http://192.210.5.8:5173
  credentials: true
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ========== pycorrector 代理路由 ==========
app.post('/api/correct', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:5008/correct', req.body, {
      timeout: 30000
    });
    res.json(response.data);
  } catch (error) {
    console.error('[pycorrector] 代理请求失败:', error.message);
    res.json({ errors: [] });
  }
});

// ========== 静态文件服务 ==========
const uploadDir = path.join(__dirname, "uploads");
app.use("/uploads", express.static(uploadDir));

// 确保上传目录存在
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ========== 文件上传配置 ==========
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
      'text/markdown'
    ];

    const allowedExt = ['.txt', '.doc', '.docx', '.pdf', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${file.originalname}。支持: ${allowedExt.join(', ')}`));
    }
  }
});

// ========== 改进的文本清理函数 ==========
function cleanExtractedText(text) {
  if (!text) return '';

  console.log('清理前文本长度:', text.length, '前100字符:', text.substring(0, 100));

  // 1. 首先移除明显的乱码字符
  let cleaned = text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')  // 移除控制字符
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\d,.!?;:"'()\-—–，。！？；：《》【】「」\n\r]/g, ' ');

  // 2. 标准化换行符
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. 尝试恢复 doc 文件丢失的换行（句号、问号、感叹号、分号、冒号、换段落后加换行）
  cleaned = cleaned.replace(/([。！？；:])\s*/g, '$1\n');

  // 4. 替换多个空格为单个空格
  cleaned = cleaned.replace(/\t/g, ' ')
    .replace(/ +/g, ' ');

  // 5. 清理多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').replace(/\n{2,}/g, '\n').trim();

  // 6. 过滤有效行（更宽松的条件）
  const lines = cleaned.split('\n');
  const validLines = lines.filter(line => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return false;
    // 只要有任意有效内容就保留
    const hasContent = trimmedLine.length >= 3;
    return hasContent;
  });
  cleaned = validLines.join('\n');

  // 7. 再次清理多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  console.log('清理后文本长度:', cleaned.length, '前100字符:', cleaned.substring(0, 100));

  // 5. 如果清理后内容太少，返回原始文本的简化版本
  if (cleaned.length < 100 && text.length > 1000) {
    console.log('清理过度，返回简化版本');
    return text
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\d,.!?;:"'()\-—–，。！？；\n\r]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
  }

  return cleaned;
}

// ========== 新增：计算文本质量函数 ==========
function calculateTextQuality(text) {
  if (!text || text.length < 10) return 0;

  let score = 0;

  // 1. 中文字符数量
  const chineseMatches = text.match(/[\u4e00-\u9fa5]/g);
  const chineseCount = chineseMatches ? chineseMatches.length : 0;
  score += chineseCount * 2;

  // 2. 有效单词数量
  const wordMatches = text.match(/[a-zA-Z]{3,}/g);
  const wordCount = wordMatches ? wordMatches.length : 0;
  score += wordCount;

  // 3. 标点符号数量（表示结构完整）
  const punctuationMatches = text.match(/[，。！？；：,.!?;:]/g);
  const punctuationCount = punctuationMatches ? punctuationMatches.length : 0;
  score += punctuationCount * 0.5;

  // 4. 惩罚乱码字符
  const garbageMatches = text.match(/[�]/g);
  const garbageCount = garbageMatches ? garbageMatches.length : 0;
  score -= garbageCount * 10;

  // 5. 惩罚连续相同字符（可能是乱码）
  const repeatingMatches = text.match(/(.)\1{5,}/g);
  const repeatingCount = repeatingMatches ? repeatingMatches.length : 0;
  score -= repeatingCount * 20;

  // 6. 奖励合理的行长度分布
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length > 3) {
    const avgLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    if (avgLength > 20 && avgLength < 200) {
      score += 50;
    }
  }

  return score;
}

// ========== 新增：提取文本片段函数 ==========
function extractTextFragments(buffer) {
  const fragments = [];

  // 在二进制数据中查找可能的文本片段
  let inText = false;
  let currentFragment = '';

  for (let i = 0; i < buffer.length - 1; i++) {
    const byte1 = buffer[i];
    const byte2 = buffer[i + 1];

    // 检查是否可能是中文字符（GBK编码范围）
    const isPossibleChinese = (byte1 >= 0xA1 && byte1 <= 0xFE && byte2 >= 0xA1 && byte2 <= 0xFE);

    // 检查是否可能是可打印ASCII
    const isPrintable = (byte1 >= 32 && byte1 <= 126);

    if (isPossibleChinese || isPrintable) {
      if (!inText) {
        inText = true;
      }

      if (isPossibleChinese) {
        // 处理双字节字符
        try {
          const char = String.fromCharCode(byte1, byte2);
          currentFragment += char;
          i++; // 跳过下一个字节
        } catch (e) {
          // 忽略错误
        }
      } else {
        // 处理单字节字符
        currentFragment += String.fromCharCode(byte1);
      }
    } else {
      if (inText && currentFragment.length > 10) {
        // 结束当前片段
        fragments.push(currentFragment);
        currentFragment = '';
      }
      inText = false;
    }
  }

  // 处理最后一个片段
  if (currentFragment.length > 10) {
    fragments.push(currentFragment);
  }

  return fragments;
}

// ========== 新增：纯文本提取函数 ==========
async function extractPlainTextFromBinary(filePath) {
  console.log("执行纯文本提取...");

  try {
    const buffer = fs.readFileSync(filePath);

    // 最简单的提取方法：只提取可打印字符
    let text = '';
    let consecutivePrintable = 0;

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];

      // 可打印ASCII范围
      if (byte >= 32 && byte <= 126) {
        text += String.fromCharCode(byte);
        consecutivePrintable++;
      } else if (byte === 10 || byte === 13) {
        // 换行符
        if (consecutivePrintable > 3) {
          text += '\n';
        }
        consecutivePrintable = 0;
      } else if (byte === 9) {
        // 制表符
        if (consecutivePrintable > 3) {
          text += ' ';
        }
      } else {
        // 非打印字符，如果之前有连续可打印字符，加空格
        if (consecutivePrintable > 3) {
          text += ' ';
        }
        consecutivePrintable = 0;
      }
    }

    // 清理结果
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length > 100) {
      console.log(`纯文本提取成功，长度: ${text.length}`);
      return text;
    }

    return null;

  } catch (error) {
    console.log(`纯文本提取错误: ${error.message}`);
    return null;
  }
}

// ========== 新增：检查是否有意义的文本 ==========
function isMeaningfulText(text) {
  if (!text || text.length < 10) return false;

  // 检查是否有中文字符或完整单词
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  const hasCompleteWords = /[a-zA-Z]{3,}/.test(text);
  const hasMeaningfulPunctuation = /[，。！？；：,.!?;:]/.test(text);

  // 排除明显的乱码
  const hasGarbage = /[�]{3,}/.test(text);
  const isRepeating = /^(.)\1+$/.test(text);

  return (hasChinese || hasCompleteWords || hasMeaningfulPunctuation) &&
      !hasGarbage && !isRepeating;
}

// ========== 新增：清理WPS提取的文本 ==========
function cleanWpsExtractedText(text) {
  if (!text) return '';

  console.log('WPS原始文本长度:', text.length, '前100字符:', text.substring(0, 100));

  // 1. 移除明显的二进制垃圾
  let cleaned = text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/Root Entry|Summary Information|Document Summary Information|Word Document/gi, ' ')
      .replace(/WPS Office|KSO ProductBuildVer|KSO Template/gi, ' ')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\d,.!?;:"'()\-—–，。！？；：《》【】「」\n\r]/g, ' ');

  // 2. 基础清理
  cleaned = cleaned
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // 3. 提取有效的行
  const lines = cleaned.split('\n');
  const validLines = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // 检查是否包含有意义的内容
    const hasChinese = /[\u4e00-\u9fa5]/.test(trimmedLine);
    const hasEnglishWords = /[a-zA-Z]{3,}/.test(trimmedLine);
    const hasNumbers = /\d+/.test(trimmedLine);
    const hasPunctuation = /[，。！？；：,.!?;:]/.test(trimmedLine);

    if (hasChinese || hasEnglishWords || (hasNumbers && trimmedLine.length > 5) || hasPunctuation) {
      validLines.push(trimmedLine);
    }
  }

  cleaned = validLines.join('\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  console.log('WPS清理后文本长度:', cleaned.length, '前100字符:', cleaned.substring(0, 100));
  return cleaned;
}

// ========== 新增：使用系统工具提取WPS内容 ==========
async function extractWpsContentWithSystem(filePath) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }

    console.log("尝试使用Windows系统工具提取WPS内容...");

    const commands = [
      `powershell "Get-Content -Raw -Encoding Default '${filePath}' | Select-String -Pattern '[\\u4e00-\\u9fa5a-zA-Z0-9]+' -AllMatches | ForEach-Object { $_.Matches.Value } | Join-String -Separator ' '"`,
      `findstr /C:"." "${filePath}"`,
      `type "${filePath}"`
    ];

    let currentIndex = 0;

    function tryNextCommand() {
      if (currentIndex >= commands.length) {
        resolve(null);
        return;
      }

      const cmd = commands[currentIndex];
      console.log(`尝试命令 ${currentIndex + 1}: ${cmd.substring(0, 50)}...`);

      exec(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5000
      }, (err, stdout, stderr) => {
        if (!err && stdout && stdout.trim().length > 50) {
          console.log(`✅ 命令成功，提取文本长度: ${stdout.length}`);
          resolve(stdout);
        } else {
          console.log(`❌ 命令失败`);
          currentIndex++;
          setTimeout(tryNextCommand, 100);
        }
      });
    }

    tryNextCommand();
  });
}

// ========== 新增：从WPS二进制提取文本 ==========
function extractTextFromWpsBinary(buffer) {
  const fragments = [];

  // WPS文档中文本可能以特定方式编码
  // 寻找可能的文本区域
  const textStartMarkers = [
    Buffer.from([0x00, 0x00, 0x01, 0x00]), // 可能的文本开始标记
    Buffer.from('正文', 'binary'),
    Buffer.from('内容', 'binary'),
    Buffer.from('text', 'binary'),
    Buffer.from('TEXT', 'binary')
  ];

  // 在不同位置尝试不同编码
  const chunkSize = 1024;
  const encodings = ['utf8', 'gbk', 'gb2312', 'utf16le'];

  for (let offset = 0; offset < buffer.length - chunkSize; offset += chunkSize) {
    const chunk = buffer.slice(offset, offset + chunkSize);

    for (const encoding of encodings) {
      try {
        const chunkText = chunk.toString(encoding);

        // 检查是否有实际内容（非乱码）
        if (isMeaningfulText(chunkText)) {
          fragments.push(chunkText);
        }
      } catch (e) {
        // 忽略编码错误
      }
    }
  }

  return fragments;
}

// ========== 新增：WPS Office文档专用解析函数 ==========
async function parseWpsDocFile(filePath) {
  console.log("检测到WPS Office文档，使用专用解析器...");

  try {
    const buffer = fs.readFileSync(filePath);

    // WPS Office文档通常包含特定的标记
    const wpsMarkers = [
      'WPS Office',
      'KSO ProductBuildVer',
      'KSO Template',
      'Kingsoft Office'
    ];

    // 检查是否是WPS文档
    const bufferString = buffer.toString('binary');
    let isWpsDoc = false;
    for (const marker of wpsMarkers) {
      if (bufferString.includes(marker)) {
        isWpsDoc = true;
        console.log(`检测到WPS标记: ${marker}`);
        break;
      }
    }

    if (!isWpsDoc) {
      return null;
    }

    // 策略1: 尝试提取文本片段
    console.log("策略1: 从WPS文档提取文本片段...");
    const textFragments = extractTextFromWpsBinary(buffer);

    if (textFragments.length > 0) {
      const combinedText = textFragments.join('\n');
      console.log(`从WPS文档提取到 ${textFragments.length} 个文本片段`);

      // 清理和整理文本
      const cleanedText = cleanWpsExtractedText(combinedText);
      if (cleanedText.length > 100) {
        return cleanedText;
      }
    }

    // 策略2: 使用专门的WPS解析方法
    console.log("策略2: 使用WPS专用解析...");
    const wpsText = await extractWpsContentWithSystem(filePath);
    if (wpsText && wpsText.length > 100) {
      return wpsText;
    }

    return null;

  } catch (error) {
    console.log(`WPS文档解析错误: ${error.message}`);
    return null;
  }
}

// ========== 新增：智能二进制解析函数 ==========
async function parseDocBinaryIntelligent(filePath) {
  console.log("执行智能二进制解析...");

  try {
    const buffer = fs.readFileSync(filePath);

    // 策略1: 尝试常见的文本编码
    const encodings = ['utf8', 'gbk', 'gb2312', 'utf16le', 'latin1', 'binary'];
    let bestText = '';
    let bestScore = 0;

    for (const encoding of encodings) {
      try {
        let text = buffer.toString(encoding);

        // 计算文本质量分数
        const score = calculateTextQuality(text);

        if (score > bestScore) {
          bestText = text;
          bestScore = score;
          console.log(`编码 ${encoding} 得分: ${score}, 文本长度: ${text.length}`);
        }
      } catch (e) {
        // 忽略编码错误
      }
    }

    // 如果找到了质量较好的文本
    if (bestScore > 30 && bestText.length > 100) {
      console.log(`最佳编码得分: ${bestScore}, 文本长度: ${bestText.length}`);
      return bestText;
    }

    // 策略2: 寻找文档中的文本片段
    console.log("执行策略2: 寻找文本片段...");
    const textFragments = extractTextFragments(buffer);
    if (textFragments.length > 0) {
      const combinedText = textFragments.join(' ');
      console.log(`找到 ${textFragments.length} 个文本片段，总长度: ${combinedText.length}`);
      return combinedText;
    }

    // 策略3: 提取所有可打印字符
    console.log("执行策略3: 提取所有可打印字符...");
    let printableText = '';
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      // 包括空格、字母、数字、标点
      if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
        printableText += String.fromCharCode(byte);
      } else if (byte >= 0xA1 && byte <= 0xFE) {
        // 可能的GBK编码字符
        printableText += String.fromCharCode(byte);
      }
    }

    if (printableText.length > 100) {
      console.log(`提取可打印字符成功，长度: ${printableText.length}`);
      return printableText;
    }

    return null;

  } catch (error) {
    console.log(`智能二进制解析错误: ${error.message}`);
    return null;
  }
}

// ========== 增强的系统命令解析 ==========
async function parseDocWithSystemEnhanced(filePath) {
  return new Promise((resolve, reject) => {
    console.log("增强系统命令解析...");

    const commands = [];

    if (process.platform === 'linux' || process.platform === 'darwin') {
      commands.push(
          { cmd: `catdoc -d utf-8 "${filePath}"`, name: "catdoc-utf8" },
          { cmd: `catdoc "${filePath}"`, name: "catdoc" },
          { cmd: `antiword -m UTF-8 "${filePath}"`, name: "antiword-utf8" },
          { cmd: `antiword "${filePath}"`, name: "antiword" },
          { cmd: `strings "${filePath}" | grep -E "[\\u4e00-\\u9fa5a-zA-Z0-9]"`, name: "strings-grep" }
      );
    } else if (process.platform === 'win32') {
      const winPath = filePath.replace(/'/g, '"');
      commands.push(
          { cmd: `powershell "Get-Content -Encoding UTF8 '${winPath}'"`, name: "powershell-utf8" },
          { cmd: `powershell "Get-Content '${winPath}'"`, name: "powershell" },
          { cmd: `type "${winPath}"`, name: "cmd-type" },
          { cmd: `findstr /C:"." "${winPath}"`, name: "findstr" }
      );
    }

    let currentIndex = 0;

    function tryNextCommand() {
      if (currentIndex >= commands.length) {
        reject(new Error("所有系统命令都失败了"));
        return;
      }

      const { cmd, name } = commands[currentIndex];
      console.log(`尝试命令: ${name} (${cmd})`);

      exec(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000
      }, (err, stdout, stderr) => {
        if (!err && stdout && stdout.trim().length > 50) {
          console.log(`✅ ${name}命令成功`);
          resolve(stdout);
        } else {
          console.log(`❌ ${name}命令失败`);
          currentIndex++;
          setTimeout(tryNextCommand, 100);
        }
      });
    }

    tryNextCommand();
  });
}

// ========== 改进的DOC文件解析函数 ==========
async function parseDocFile(filePath, originalName) {
  console.log(`🔍 开始解析DOC文件: ${originalName}`);

  try {
    // 方法0: 优先使用 word-extractor 解析 (最可靠的纯 JS 方案)
    console.log("尝试方法0: 使用 word-extractor 解析...");
    try {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      const text = extracted.getBody();
      if (text && text.trim().length > 10) {
        console.log(`✅ word-extractor 解析成功，文本长度: ${text.length}`);
        return cleanExtractedText(text);
      }
    } catch (weError) {
      console.log(`word-extractor 解析失败: ${weError.message}`);
    }

    // 先检查是否是WPS Office文档
    console.log("检查是否为WPS Office文档...");
    const wpsText = await parseWpsDocFile(filePath);
    if (wpsText && wpsText.trim().length > 100) {
      console.log(`✅ WPS文档解析成功，文本长度: ${wpsText.length}`);
      return wpsText;
    }

    // 方法1: 优先使用系统命令（如果可用）
    if (process.platform === 'win32') {
      console.log("尝试方法1: Windows系统命令解析...");
      try {
        const text = await parseDocWithSystemEnhanced(filePath);
        if (text && text.trim().length > 50) {
          console.log(`✅ Windows系统命令成功，文本长度: ${text.length}`);
          return cleanExtractedText(text);
        }
      } catch (systemError) {
        console.log(`Windows系统命令失败: ${systemError.message}`);
      }
    }

    // 方法2: 尝试作为DOCX解析（有些.doc文件实际上是.docx格式）
    console.log("尝试方法2: 作为DOCX尝试解析...");
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      if (result.value && result.value.trim().length > 50) {
        console.log(`✅ 作为DOCX解析成功，文本长度: ${result.value.length}`);
        return cleanExtractedText(result.value);
      }
    } catch (mammothError) {
      console.log(`作为DOCX解析失败: ${mammothError.message}`);
    }

    // 方法3: 智能二进制解析
    console.log("尝试方法3: 智能二进制解析...");
    try {
      const text = await parseDocBinaryIntelligent(filePath);
      if (text && text.trim().length > 50) {
        console.log(`✅ 智能二进制解析成功，文本长度: ${text.length}`);
        return cleanExtractedText(text);
      }
    } catch (binaryError) {
      console.log(`智能二进制解析失败: ${binaryError.message}`);
    }

    // 方法4: 纯文本提取
    console.log("尝试方法4: 纯文本提取...");
    try {
      const text = await extractPlainTextFromBinary(filePath);
      if (text && text.trim().length > 10) {
        console.log(`✅ 纯文本提取成功，文本长度: ${text.length}`);
        return cleanExtractedText(text);
      }
    } catch (finalError) {
      console.log(`纯文本提取失败: ${finalError.message}`);
    }

    throw new Error("DOC文件解析失败，所有方法都尝试过了");

  } catch (error) {
    console.error("❌ DOC文件解析完全失败:", error.message);
    throw error;
  }
}

// ========== 文件解析函数 ==========

// 解析TXT文件
async function parseTxtFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    console.log(`✅ TXT文件解析成功，长度: ${content.length}`);
    return content;
  } catch (error) {
    throw new Error(`TXT文件解析失败: ${error.message}`);
  }
}

// 解析PDF文件
async function parsePdfFile(filePath) {
  try {
    console.log("解析PDF文件...");
    const dataBuffer = fs.readFileSync(filePath);
    // pdf-parse 默认只解析前几页，设置 max: 0 以解析所有页面
    const data = await pdfParse(dataBuffer, { max: 0 });
    console.log(`✅ PDF文件解析成功，长度: ${data.text.length}`);
    return data.text;
  } catch (error) {
    throw new Error(`PDF文件解析失败: ${error.message}`);
  }
}

// 解析MD文件
async function parseMdFile(filePath) {
  try {
    console.log("解析MD文件...");
    const content = fs.readFileSync(filePath, "utf-8");
    console.log(`✅ MD文件解析成功，长度: ${content.length}`);
    return content;
  } catch (error) {
    throw new Error(`MD文件解析失败: ${error.message}`);
  }
}

// 根据文件扩展名选择解析器
async function parseDocument(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  console.log(`📄 开始解析文件: ${originalName} (${ext})`);

  switch (ext) {
    case '.txt':
      return await parseTxtFile(filePath);
    case '.doc':
      console.log("⚠️  检测到老版DOC格式，使用增强解析器...");
      try {
        const text = await parseDocFile(filePath, originalName);
        if (!text || text.trim().length === 0) {
          throw new Error("解析出的文本为空");
        }
        console.log(`🎉 DOC文件解析成功! 文本长度: ${text.length}`);
        return text;
      } catch (docError) {
        console.error("DOC文件解析失败:", docError.message);
        const friendlyError = new Error();
        friendlyError.message = "DOC文件解析失败";
        friendlyError.details = docError.message;
        friendlyError.suggestions = [
          "1. 使用Microsoft Word打开并另存为DOCX格式",
          "2. 将文件内容复制到TXT文件中",
          "3. 使用在线转换工具转换为DOCX/PDF格式",
          "4. 如果是重要文件，建议使用新版DOCX格式保存"
        ];
        throw friendlyError;
      }
    case '.docx':
      console.log("处理DOCX文件...");
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        if (result.value && result.value.trim().length > 0) {
          console.log(`✅ DOCX文件解析成功，长度: ${result.value.length}`);
          return cleanExtractedText(result.value);
        } else {
          throw new Error("DOCX文件内容为空");
        }
      } catch (docxError) {
        throw new Error(`DOCX文件解析失败: ${docxError.message}`);
      }
    case '.pdf':
      return await parsePdfFile(filePath);
    case '.md':
      return await parseMdFile(filePath);
    default:
      throw new Error(`不支持的文件格式: ${ext}`);
  }
}

// ========== 错别字检查逻辑 ==========

/**
 * 动态加载错别字规则库
 * 实现动态化：修改 rules.json 即可生效，无需重启后端
 */
function loadErrorPatterns() {
  try {
    const rulesPath = path.join(__dirname, "rules.json");
    if (fs.existsSync(rulesPath)) {
      const data = fs.readFileSync(rulesPath, "utf8");
      const patterns = JSON.parse(data);
      console.log(`📊 已加载 ${patterns.length} 条基础纠错规则`);
      return patterns;
    }
  } catch (error) {
    console.error("❌ 加载规则库失败:", error.message);
  }
  return [];
}

/**
 * 检查文本中的错别字 (基于规则引擎)
 * @param {string} text 待检查文本
 * @returns {object} 包含错误列表和修正后的文本
 */
function checkTextForErrors(text) {
  if (!text) return { errors: [], correctedText: "" };

  const errorPatterns = loadErrorPatterns();
  const errors = [];
  let correctedText = text;

  errorPatterns.forEach(pattern => {
    // 将字符串模式转换为正则表达式
    const regex = new RegExp(pattern.pattern, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      // 如果原文和建议修正后的一样，说明是白名单，跳过
      if (match[0] === pattern.correct) continue;

      errors.push({
        position: match.index,
        errorWord: match[0],
        correctWord: pattern.correct,
        reason: pattern.reason,
        context: text.substring(
            Math.max(0, match.index - 20),
            Math.min(text.length, match.index + match[0].length + 20)
        )
      });
    }

    correctedText = correctedText.replace(regex, pattern.correct);
  });

  // === 新增：重复字检查 (简单的 AA 模式，排除常见叠词) ===
  // 排除列表：常见的叠词，如 "天天", "看看", "试试", "恰恰", "处处", "人人", "年年", "轻轻" 等
  const allowedRepeats = new Set([
    "天天", "年年", "月月", "人人", "处处", "事事", "层层", "恰恰", "默默", "往往", 
    "渐渐", "缓缓", "慢慢", "轻轻", "悄悄", "匆匆", "刚刚", "偏偏", "仅仅", "频频", 
    "声声", "句句", "字字", "代代", "辈辈", "常常", "通通", "区区", "星星", "点点",
    "看看", "说说", "听听", "写写", "练练", "想想", "问问", "查查", "试试", "改改",
    "国国", "港港", "用用", "地地"
  ]);

  const repeatRegex = /([\u4e00-\u9fa5])\1{2,}/g; // 匹配连续三个或以上相同的汉字
  let repeatMatch;
  while ((repeatMatch = repeatRegex.exec(text)) !== null) {
    const word = repeatMatch[0];
    // 对于三个及以上的重复，不再检查 allowedRepeats，直接报错
    errors.push({
        position: repeatMatch.index,
        errorWord: word,
        correctWord: word[0], // 建议只保留一个
        reason: "明显重复录入",
        context: text.substring(
            Math.max(0, repeatMatch.index - 20),
            Math.min(text.length, repeatMatch.index + word.length + 20)
        )
    });
  }

  console.log(`✅ 错别字检查完成，发现 ${errors.length} 处错误`);
  return { errors, correctedText };
}

// ========== 路由定义 ==========

// 1. 根路径
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "文档错别字识别系统API",
    version: "3.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      root: "GET /",
      health: "GET /health",
      test: "GET /api/test",
      upload: "POST /api/upload",
      aiCheck: "POST /api/check/ai",
      manualCheck: "POST /api/check/manual",
      files: "GET /api/files"
    },
    supportedFormats: ["TXT", "DOC", "DOCX", "PDF", "MD"],
    features: {
      docSupport: "超级增强版DOC解析(4种方法+智能提取)",
      errorPatterns: "100+常见错别字规则",
      fileSize: "最大100MB",
      textExtraction: "多编码支持+二进制智能解析"
    }
  });
});

// 2. 健康检查
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "doc-correct-backend",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "3.0.0",
    docSupport: "超级增强版",
    platform: process.platform
  });
});

// 3. 测试接口
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "后端API工作正常",
    timestamp: new Date().toISOString(),
    version: "3.0.0",
    docSupport: "已启用超级增强解析",
    features: [
      "增强DOC二进制解析",
      "多系统命令支持",
      "智能文本清理",
      "多编码尝试"
    ]
  });
});

// 4. 文件上传接口
app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "未收到文件",
        hint: "请选择要上传的文件"
      });
    }

    console.log("📤 文件上传成功:", {
      文件名: req.file.originalname,
      保存名: req.file.filename,
      大小: `${(req.file.size / 1024).toFixed(2)} KB`,
      类型: req.file.mimetype,
      扩展名: path.extname(req.file.originalname)
    });

    res.json({
      success: true,
      message: "文件上传成功",
      file: {
        id: req.file.filename,
        originalName: req.file.originalname,
        savedName: req.file.filename,
        size: req.file.size,
        sizeReadable: `${(req.file.size / 1024).toFixed(2)} KB`,
        mimetype: req.file.mimetype,
        extension: path.extname(req.file.originalname),
        url: `/uploads/${req.file.filename}`,
        uploadTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("上传错误:", error);
    res.status(500).json({
      success: false,
      error: "文件上传失败",
      message: error.message
    });
  }
});

// 5. AI智能检查接口（完整处理流程）- 修复版
app.post("/api/check/ai", upload.single("file"), async (req, res) => {
    console.log('收到 /api/check/ai 请求');
  try {
    console.log("\n" + "=".repeat(50));
    console.log("🤖 开始AI智能检查请求");
    console.log("=".repeat(50));

    // 是否只解析不检查
    const onlyParse = req.query.parse === 'true' || req.body.parse === 'true';

    // 情况1：直接上传文件
    if (req.file) {
      console.log(`处理上传的文件: ${req.file.originalname}`);
      console.log(`文件类型: ${req.file.mimetype}`);
      console.log(`文件大小: ${req.file.size} bytes`);
      if (onlyParse) {
        console.log("模式: 仅解析文本，不进行错别字检查");
      }

      const filePath = path.join(uploadDir, req.file.filename);

      try {
        // 解析文件内容
        const text = await parseDocument(filePath, req.file.originalname);
        console.log(`✅ 文件解析成功，文本长度: ${text.length}`);
        console.log(`📊 文本前500字符:`, text.substring(0, 500));
        console.log(`📊 文本中文字符统计:`, (text.match(/[\u4e00-\u9fa5]/g) || []).length);

        // 如果只是解析，直接返回文本
        if (onlyParse) {
          // 清理临时文件
          try {
            fs.unlinkSync(filePath);
            console.log("✅ 临时文件已清理");
          } catch (cleanError) {
            console.log("⚠️  临时文件清理失败:", cleanError.message);
          }

          return res.json({
            success: true,
            data: {
              originalText: text,
              fileInfo: {
                name: req.file.originalname,
                type: path.extname(req.file.originalname),
                size: req.file.size,
                sizeReadable: `${(req.file.size / 1024).toFixed(2)} KB`,
                textLength: text.length
              }
            },
            message: "文件解析成功"
          });
        }

        // 1. 优先用大模型（如Qwen）进行错别字校对
        let aiResult = null;
        try {
          const prompt = `你是一名严格的中文错别字校对员，只做文字纠错，不做任何润色或优化。

### 严格规则：
1. 只识别以下类型的错误：
   - 同音字误用（如：因该→应该、以经→已经）
   - 形近字错误（如：辩认→辨认、既使→即使）
   - OCR识别错误（如：咳血评估→科学评估）
   - 成语俗语错误（如：再接再励→再接再厉）
2. 以下情况绝对不要报告：
   - 语句优化建议
   - 用词风格改进
   - 标点符号规范（除非明显错误）
   - 语法优化建议
3. 有错才报，无错不报！如果没有发现错别字，返回空数组

### 输出格式：
只返回JSON数组，格式如下：
[{"errorWord":"错误词","correctWord":"正确词","position":起始位置}]

### 待校对文本：
${text}`;
          const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11435/api/generate';
          const ollamaPayload = {
            model: process.env.OLLAMA_MODEL || 'qwen3:30b',
            prompt: prompt,
            stream: false
          };
          const aiRes = await axios.post(ollamaUrl, ollamaPayload, { headers: { 'Content-Type': 'application/json' }, timeout: 120000 });
          let aiText = aiRes.data?.response || aiRes.data?.text || aiRes.data;
          const jsonMatch = aiText.match(/\[.*\]/s);
          aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiText);
        } catch (e) {
          console.error("AI错别字校对失败，降级为规则库：", e.message);
        }

        // 2. 调用pycorrector服务
        let pycResult = null;
        try {
          console.log('[pycorrector] 正在请求 pycorrector 服务...');
          const pycRes = await axios.post('http://127.0.0.1:5008/correct', { text });
          pycResult = pycRes.data?.errors || [];
          console.log(`[pycorrector] 返回错别字数量: ${pycResult.length}`);
        } catch (e) {
          console.error("[pycorrector] 服务调用失败：", e.message);
        }

        // 3. 规则库辅助
        const { errors: ruleErrors, correctedText } = checkTextForErrors(text);

        // 4. 合并三方结果（去重，优先AI>pycorrector>规则库）
        let allErrors = [];
        const key = e => e.errorWord + '@' + e.position;
        const aiSet = aiResult && Array.isArray(aiResult) ? new Set(aiResult.map(key)) : new Set();
        const pycSet = pycResult && Array.isArray(pycResult) ? new Set(pycResult.map(key)) : new Set();
        if (aiResult && Array.isArray(aiResult)) {
          allErrors = aiResult.slice();
        }
        if (pycResult && Array.isArray(pycResult)) {
          allErrors = allErrors.concat(pycResult.filter(e => !aiSet.has(key(e))));
        }
        allErrors = allErrors.concat(ruleErrors.filter(e => !aiSet.has(key(e)) && !pycSet.has(key(e))));

        // 5. 清理临时文件
        try {
          fs.unlinkSync(filePath);
          console.log("✅ 临时文件已清理");
        } catch (cleanError) {
          console.log("⚠️  临时文件清理失败:", cleanError.message);
        }

        console.log(`📊 检查结果: 发现 ${allErrors.length} 处错别字`);
        console.log("=".repeat(50));

        return res.json({
          success: true,
          data: {
            originalText: text,
            correctedText: correctedText,
            errors: allErrors,
            count: allErrors.length,
            fileInfo: {
              name: req.file.originalname,
              type: path.extname(req.file.originalname),
              size: req.file.size,
              sizeReadable: `${(req.file.size / 1024).toFixed(2)} KB`,
              textLength: text.length
            },
            stats: {
              totalChars: text.length,
              errorCount: allErrors.length,
              errorRate: (allErrors.length / Math.max(text.length, 1)).toFixed(6),
              checkedAt: new Date().toISOString(),
              processingTime: process.uptime()
            }
          },
          message: allErrors.length > 0 ?
              `🎯 发现 ${allErrors.length} 处错别字` :
              "✅ 未发现错别字，文本质量良好"
        });
      } catch (parseError) {
        console.error("❌ 文件解析失败:", parseError.message);

        // 清理临时文件
        try {
          fs.unlinkSync(filePath);
        } catch (e) {}

        // 针对DOC文件的详细提示
        let hint = "";
        let retrySteps = [];
        let fallbackOptions = [];

        if (req.file.originalname.toLowerCase().endsWith('.doc')) {
          hint = "老版DOC文件解析失败";
          retrySteps = [
            "💡 解决方案1: 用Microsoft Word打开并另存为DOCX格式（最可靠）",
            "💡 解决方案2: 将内容复制粘贴到新建的TXT文件中",
            "💡 解决方案3: 使用在线转换工具(如ilovepdf.com、smallpdf.com)",
            "💡 解决方案4: 安装catdoc或antiword工具增强解析能力"
          ];

          fallbackOptions = [
            {
              label: "直接上传文本",
              action: "copy_paste",
              desc: "手动复制文本内容到文本框"
            },
            {
              label: "转换为PDF",
              action: "convert_pdf",
              desc: "使用打印机功能另存为PDF"
            }
          ];
        }

        return res.status(400).json({
          success: false,
          error: "文件解析失败",
          message: parseError.message,
          hint: hint,
          retrySteps: retrySteps,
          fallbackOptions: fallbackOptions,
          fileType: path.extname(req.file.originalname),
          supportContact: process.env.SUPPORT_EMAIL || "admin@example.com"
        });
      }
    }

    // 情况2：直接提供文本
    const { text } = req.body;
    if (text) {
      console.log("处理直接提供的文本，长度:", text.length);

      const { errors, correctedText } = checkTextForErrors(text);

      return res.json({
        success: true,
        data: {
          originalText: text,
          correctedText: correctedText,
          errors: errors,
          count: errors.length
        },
        message: errors.length > 0 ?
            `发现 ${errors.length} 处错别字` :
            "文本正确"
      });
    }

    // 情况3：都没有提供
    return res.status(400).json({
      success: false,
      error: "需要提供文件或文本内容",
      hint: "请上传文件或直接发送文本进行AI检查"
    });
  } catch (error) {
    console.error("❌ AI检查过程错误:", error);

    res.status(500).json({
      success: false,
      error: "AI检查失败",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 6. 手动检查接口
app.post("/api/check/manual", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "需要文本内容"
      });
    }

    const { errors, correctedText } = checkTextForErrors(text);

    res.json({
      success: true,
      data: {
        text: text,
        correctedText: correctedText,
        errors: errors,
        count: errors.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "手动检查失败",
      message: error.message
    });
  }
});

// 7. 获取文件列表
app.get("/api/files", (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir)
        .filter(file => !file.startsWith("."))
        .map(file => {
          const filePath = path.join(uploadDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            size: stats.size,
            sizeReadable: `${(stats.size / 1024).toFixed(2)} KB`,
            created: stats.birthtime,
            url: `/uploads/${file}`
          };
        });

    res.json({
      success: true,
      count: files.length,
      files: files
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "获取文件列表失败",
      message: error.message
    });
  }
});

// 新增：代理Ollama的API接口
app.post("/api/ollama/generate", async (req, res) => {
  console.log("🤖 收到前端的Ollama代理请求");

  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11435/api/generate';
    console.log(`将请求转发到Ollama服务: ${ollamaUrl}`);

    // 直接将前端的请求体转发给Ollama
    const response = await axios.post(ollamaUrl, req.body, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 设置一个较长的超时时间，例如2分钟
    });

    console.log("✅ 成功从Ollama获取响应");
    // 将Ollama的响应原样返回给前端
    res.json(response.data);

  } catch (error) {
    console.error("❌ 转发到Ollama失败:", error.message);
    if (error.response) {
      console.error('Ollama返回的错误详情:', error.response.data);
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: "无法连接到Ollama服务",
        message: `无法连接到 ${error.config.url}，请确保Ollama服务正在运行并且地址配置正确。`
      });
    } else {
      res.status(500).json({
        success: false,
        error: "代理请求失败",
        message: error.message
      });
    }
  }
});


// ========== 404处理 ==========
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "接口不存在",
    path: req.originalUrl,
    method: req.method,
    hint: "请访问 / 查看可用接口"
  });
});

// ========== 错误处理中间件 ==========
app.use((err, req, res, next) => {
  console.error("🚨 服务器错误:", err.stack);

  res.status(500).json({
    success: false,
    error: "服务器内部错误",
    message: process.env.NODE_ENV === "development" ? err.message : "请联系管理员",
    timestamp: new Date().toISOString()
  });
});

// ========== 启动服务器 ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 文档错别字识别系统 - 后端服务启动成功！");
  console.log("=".repeat(70));
  console.log(`📍 服务地址: http://0.0.0.0:${PORT}`);
  console.log(`📁 上传目录: ${uploadDir}`);
  console.log(`🏗️  运行平台: ${process.platform}`);
  console.log("📄 支持格式: TXT, DOC, DOCX, PDF, MD");
  console.log("🔧 DOC支持: 超级增强版(4种解析方法+智能提取)");
  console.log("🤖 AI检查: 20+常见错别字规则");
  console.log("=".repeat(70));
  console.log("📡 主要接口:");
  console.log(`   1. GET  http://localhost:${PORT}/          - API信息`);
  console.log(`   2. GET  http://localhost:${PORT}/health    - 健康检查`);
  console.log(`   3. POST http://localhost:${PORT}/api/check/ai - AI智能检查`);
  console.log("=".repeat(70));
  console.log("💡 提示: 对于DOC文件，系统将尝试多种智能方法解析");
  console.log("🛠️  建议: 安装catdoc或antiword工具以增强DOC解析能力");
  console.log("=".repeat(70) + "\n");
});