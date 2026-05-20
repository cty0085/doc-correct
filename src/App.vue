<template>
  <div class="app-container">
    <h1 class="title">文档错别字识别与智能修正</h1>
    <h2 class="subtitle">支持格式：TXT、DOC、DOCX、PDF</h2>

    <div class="upload-section">
      <div class="file-input-container">
        <input
            type="file"
            accept=".txt,.doc,.docx,.pdf"
            @change="handleFileUpload"
            class="file-input"
            ref="fileInput"
            id="fileInput"
        />
        <label for="fileInput" class="file-input-label">
          <svg class="upload-icon" viewBox="0 0 24 24">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
          </svg>
          <span>选择文件 (TXT, DOC, DOCX,  PDF)</span>
        </label>
        <div v-if="fileName" class="file-info">
          <span class="file-name">{{ fileName }}</span>
          <span class="file-size">({{ fileSize }})</span>
          <span class="file-type-badge" :class="getFileTypeClass(fileName)">{{ getFileExtension(fileName) }}</span>
        </div>
      </div>

      <div class="button-group">
        <button
            @click="startCheck"
            :disabled="!originText || isChecking"
            class="check-btn"
        >
          <span v-if="isChecking" class="loading-spinner"></span>
          {{ isChecking ? '识别中...' : '开始识别错别字' }}
        </button>
        <button
            v-if="originText"
            @click="resetAllStates"
            class="reset-btn"
        >
          重置
        </button>

        <!-- 错别字统计/识别率 -->
        <div class="rate-input-container">
          <template v-if="!showAISection">
            <span class="rate-label">已知错别字总数</span>
            <input
              type="number"
              v-model="knownTyposCount"
              class="rate-input"
              placeholder="0"
              min="0"
            />
          </template>
          <template v-else>
            <span class="rate-label">识别率</span>
            <input
              type="text"
              :value="recognitionRate"
              class="rate-input"
              readonly
              style="color: #27ae60; font-weight: bold; cursor: default; background: #f9f9f9;"
            />
          </template>
        </div>

        <!-- 查找功能 -->
        <div class="search-container">
          <input 
            type="text" 
            v-model="searchKeyword" 
            @input="performSearch"
            @keyup.enter="nextSearchMatch"
            placeholder="查找内容..." 
            class="search-input"
          />
          <div class="search-controls" v-if="searchKeyword">
            <span class="search-count" v-if="searchResults.length > 0">
              {{ currentSearchIndex + 1 }}/{{ searchResults.length }}
            </span>
            <span class="search-count" v-else>0/0</span>
            <button @click="prevSearchMatch" class="search-nav-btn" title="上一个" :disabled="searchResults.length === 0">
              ⬆️
            </button>
            <button @click="nextSearchMatch" class="search-nav-btn" title="下一个" :disabled="searchResults.length === 0">
              ⬇️
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 处理状态 -->
    <div v-if="isProcessing" class="processing-status">
      <div class="loading-spinner large"></div>
      <div class="processing-text">{{ processingText }}</div>
    </div>

    <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

    <!-- 文件格式提示 -->
    <div v-if="fileFormatInfo" class="format-info">
      <div class="format-info-content">
        <span class="format-icon">📋</span>
        <div class="format-details">
          <div class="format-text">{{ fileFormatInfo }}</div>
          <div v-if="showConvertTips" class="convert-tips">
            <p>💡 <strong>格式转换建议：</strong></p>
            <ul>
              <li>在Microsoft Word中打开文件，选择"文件" → "另存为" → 选择"Word文档(.docx)"格式</li>
              <li>或使用在线转换工具：<a href="https://convertio.co/zh/doc-docx/" target="_blank">convertio.co</a></li>
              <li>或直接复制文本内容到新建的TXT文件中</li>
              <li v-if="pdfConversionTips">📄 <strong>PDF文件专用建议：</strong>
                <ul>
                  <li>使用Adobe Acrobat将PDF另存为TXT文件</li>
                  <li>或使用在线PDF转TXT工具：<a href="https://smallpdf.com/pdf-to-txt" target="_blank">smallpdf.com</a></li>
                  <li>或直接从PDF复制文本粘贴到TXT文件中</li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- 手动检查结果 -->
    <div v-if="originText" class="compare-container">
      <!-- 原文区域 -->
      <div class="doc-panel origin-panel">
        <div class="panel-header">
          <h3>
            <span class="panel-icon">📄</span>
            原文 ({{ originText.length }}字)
            <span v-if="showAISection && aiErrors.length > 0" class="error-count">
              AI发现{{ aiErrors.length }}处错误
            </span>
          </h3>
          <div class="panel-actions">
            <button @click="copyText(originText)" class="action-btn" title="复制原文">
              📋
            </button>
            <button @click="exportText(originText, '原文')" class="action-btn" title="导出原文">
              ⬇️
            </button>
          </div>
        </div>
        <div class="text-content" ref="originRef">
          <div class="text-line" v-for="(line, lineIndex) in textLines" :key="lineIndex">
            <span
                v-for="(char, charIndex) in line.chars"
                :key="charIndex"
                :class="[
                'char-item',
                getCharErrorClass(line.startIndex + charIndex),
                getSearchClass(line.startIndex + charIndex)
              ]"
                @click="handleCharClick(line.startIndex + charIndex)"
                :title="getCharTooltip(line.startIndex + charIndex)"
            >
              {{ char }}
            </span>
          </div>
        </div>
      </div>

      <!-- AI修正后区域 -->
      <div class="doc-panel correct-panel" v-if="showAISection && selectedCorrectedText">
        <div class="panel-header">
          <h3>
            <span class="panel-icon">✨</span>
            AI修正后文档
            <span class="error-count">
              已选择{{ selectedErrorCount }}处修正
            </span>
          </h3>
          <div class="panel-actions">
            <button @click="copyText(selectedCorrectedText)" class="action-btn" title="复制修正文本">
              📋
            </button>
            <button @click="exportText(selectedCorrectedText, 'AI修正后')" class="action-btn" title="导出修正文本">
              ⬇️
            </button>
            <button @click="applySelectedCorrections" class="action-btn apply-btn" title="应用选中修正">
              ✅
            </button>
          </div>
        </div>
        <div class="text-content">
          <div class="text-line" v-for="(line, lineIndex) in selectedCorrectedTextLines" :key="lineIndex">
            <span
                v-for="(charData, charIndex) in line.chars"
                :key="charIndex"
                :class="[
                'char-item',
                charData.isCorrected ? 'corrected-char' : ''
              ]"
                :title="charData.isCorrected ? `已修正：${charData.originalWord} → ${charData.correctWord}` : ''"
            >
              {{ charData.char }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- AI识别错误列表（带选择功能） -->
    <div v-if="showAISection && aiErrors.length > 0" class="error-list">
      <div class="selection-controls">
        <h3>
          <span class="result-icon">🤖</span>
          AI识别结果 ({{ aiErrors.length }} 处错误)
          <span class="selection-info">
            已选择 {{ selectedErrorCount }} / {{ aiErrors.length }} 处
          </span>
        </h3>
        <div class="selection-buttons">
          <button @click="selectAllErrors" class="selection-btn select-all-btn">
            <span class="checkbox-icon">☑️</span>
            全选
          </button>
          <button @click="deselectAllErrors" class="selection-btn deselect-all-btn">
            <span class="checkbox-icon">⬜</span>
            取消全选
          </button>
          <button @click="applySelectedCorrections" class="selection-btn apply-selected-btn">
            <span class="checkbox-icon">✅</span>
            应用选中修正
          </button>
          <button @click="updateSelectedCorrection" class="selection-btn update-correction-btn">
            <span class="checkbox-icon">🔄</span>
            更新预览
          </button>
        </div>
      </div>
      <div class="error-scroll-container">
        <div
            v-for="(error, index) in aiErrors"
            :key="index"
            class="error-item ai-error-item"
            :class="{ 'selected-error': error.isSelected }"
        >
          <div class="error-checkbox">
            <input
                type="checkbox"
                :id="'ai-error-' + index"
                v-model="error.isSelected"
                class="checkbox-input"
                @click.stop
            />
            <label :for="'ai-error-' + index" class="checkbox-label" @click.stop="toggleErrorSelection(index)"></label>
          </div>
          <div class="error-content-wrapper" @click="scrollToPosition(error.position)">
            <div class="error-header">
              <span class="error-index">{{ index + 1 }}</span>
              <span class="error-location">位置 {{ error.position }}</span>
              <span class="error-type">{{ error.reason }}</span>
              <button 
                class="copy-btn" 
                @click.stop="copyErrorInfo(error)"
                title="复制错误信息"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
            <div class="error-content">
              <span class="error-word">{{ error.errorWord }}</span>
              <span class="arrow">→</span>
              <span class="correct-word">{{ error.correctWord }}</span>
            </div>
            <div class="error-context" v-html="getErrorContext(error.position, error.errorWord.length)"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 复制成功提示 -->
    <div class="copy-toast" :class="{ show: copyToastVisible }">
      ✅ 复制成功
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import axios from 'axios'
import * as mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'

// 设置 PDF.js worker
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// ⭐⭐⭐ PDF.js 加载方案 (本地 import) ⭐⭐⭐

// 动态加载PDF.js的函数 (保持函数签名兼容，但改为直接返回 import 的库)
const loadPdfJs = () => {
  return Promise.resolve(pdfjsLib)
}

// 组件挂载时预加载PDF.js
onMounted(() => {
  console.log('PDF.js 已通过本地 import 加载')
})

// 响应式数据
const originText = ref('')
const selectedCorrectedText = ref('')
const isChecking = ref(false)
const isProcessing = ref(false)
const errorMsg = ref('')
const aiErrors = ref([])
const originRef = ref(null)
const fileName = ref('')
const fileSize = ref('')
const processingText = ref('')
const fileFormatInfo = ref('')
const showConvertTips = ref(false)
const showAISection = ref(false)
const pdfConversionTips = ref(false)
const knownTyposCount = ref('')

// 搜索功能状态
const searchKeyword = ref('')
const searchResults = ref([])
const currentSearchIndex = ref(-1)

// 计算属性
const recognitionRate = computed(() => {
  if (!knownTyposCount.value || parseFloat(knownTyposCount.value) === 0) {
    return '0.0%'
  }
  const count = parseFloat(knownTyposCount.value)
  const rate = (aiErrors.value.length / count) * 100
  return rate.toFixed(1) + '%'
})

const textLines = computed(() => {
  if (!originText.value) return []

  const lines = originText.value.split('\n')
  let startIndex = 0
  const result = []

  for (const line of lines) {
    result.push({
      chars: line.split(''),
      startIndex: startIndex,
      originalLine: line
    })
    startIndex += line.length + 1
  }

  return result
})

// 选择的错误数量
const selectedErrorCount = computed(() => {
  return aiErrors.value.filter(error => error.isSelected).length
})

// 选中的修正文本行
const selectedCorrectedTextLines = computed(() => {
  if (!selectedCorrectedText.value || !showAISection.value) return []

  // 获取选中的错误
  const selectedErrors = aiErrors.value.filter(error => error.isSelected)

  // 生成修正位置映射
  const correctionMap = generateAccurateCorrectionMap(selectedErrors, selectedCorrectedText.value)

  const lines = selectedCorrectedText.value.split('\n')
  const result = []

  let lineStart = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const chars = []

    for (let j = 0; j < line.length; j++) {
      const position = lineStart + j
      const correctionInfo = correctionMap.get(position)

      chars.push({
        char: line[j],
        isCorrected: !!correctionInfo,
        originalWord: correctionInfo?.originalWord || '',
        correctWord: correctionInfo?.correctWord || ''
      })
    }

    result.push({
      chars: chars,
      originalLine: line
    })
    lineStart += line.length + 1
  }

  return result
})

// 应用选中的修正到文本
const applySelectedCorrectionsToText = () => {
  const selectedErrors = aiErrors.value.filter(error => error.isSelected)

  if (selectedErrors.length === 0) {
    selectedCorrectedText.value = originText.value
    return
  }

  selectedCorrectedText.value = applyCorrectionsToText(selectedErrors)
}

// 应用修正到文本
const applyCorrectionsToText = (errors) => {
  if (!errors || errors.length === 0) {
    return originText.value
  }

  // 按位置降序排序，以便从后往前替换
  const sortedErrors = [...errors].sort((a, b) => b.position - a.position)
  let correctedText = originText.value

  // 记录已经处理的位置，避免重叠
  const processedPositions = new Set()

  sortedErrors.forEach(error => {
    const { position, errorWord, correctWord } = error

    // 检查这个位置是否已经被其他修正覆盖
    let isOverlapping = false
    for (const processedPos of processedPositions) {
      if (position >= processedPos.start && position < processedPos.end) {
        isOverlapping = true
        break
      }
    }

    if (!isOverlapping) {
      const actualText = correctedText.substr(position, errorWord.length)

      if (actualText === errorWord) {
        correctedText = correctedText.substr(0, position) +
            correctWord +
            correctedText.substr(position + errorWord.length)

        // 记录已处理的位置范围
        processedPositions.add({
          start: position,
          end: position + errorWord.length
        })
      }
    }
  })

  return correctedText
}

// 生成准确的修正位置映射
const generateAccurateCorrectionMap = (errors, correctedText) => {
  const map = new Map()

  if (!errors || errors.length === 0 || !correctedText) return map

  // 按位置排序
  const sortedErrors = [...errors].sort((a, b) => a.position - b.position)

  // 记录原始文本到修正文本的位置偏移
  let offset = 0
  let currentPos = 0
  const originalText = originText.value

  for (const error of sortedErrors) {
    const { position, errorWord, correctWord } = error

    // 计算这个修正相对于前一个修正的位置偏移
    const adjustedPosition = position + offset

    // 检查修正文本中这个位置是否是正确词
    const textAtPosition = correctedText.substr(adjustedPosition, correctWord.length)

    if (textAtPosition === correctWord) {
      // 标记这个修正的所有字符
      for (let i = 0; i < correctWord.length; i++) {
        map.set(adjustedPosition + i, {
          originalWord: errorWord,
          correctWord: correctWord
        })
      }

      // 更新偏移量（如果修正词和错误词长度不同）
      offset += (correctWord.length - errorWord.length)

      // 更新当前位置
      currentPos = adjustedPosition + correctWord.length
    } else {
      // 如果直接位置不匹配，尝试在修正文本中查找
      // 从当前位置开始搜索
      let foundPosition = correctedText.indexOf(correctWord, currentPos)

      if (foundPosition !== -1) {
        // 标记这个修正的所有字符
        for (let i = 0; i < correctWord.length; i++) {
          map.set(foundPosition + i, {
            originalWord: errorWord,
            correctWord: correctWord
          })
        }

        // 更新当前位置
        currentPos = foundPosition + correctWord.length
      }
    }
  }

  return map
}

// ⭐⭐⭐ 改进的文本提取和格式化函数 ⭐⭐⭐
const extractTextWithFormat = (textItems) => {
  if (!textItems || textItems.length === 0) return ''

  let result = ''
  let lastY = null
  let lastX = null
  let lastTextEndsWithSpace = false

  for (let i = 0; i < textItems.length; i++) {
    const item = textItems[i]
    const text = item.str
    const transform = item.transform || [1, 0, 0, 1, 0, 0]
    const x = transform[4]
    const y = transform[5]

    // 如果是新行（Y坐标变化较大）
    if (lastY !== null && Math.abs(y - lastY) > 5) {
      // 检查是否是同一段落内的换行（X坐标差异不大）
      if (lastX !== null && Math.abs(x - lastX) < 20) {
        // 可能是同一段落的自然换行，加空格
        if (!lastTextEndsWithSpace) {
          result += ' '
        }
      } else {
        // 可能是新段落或标题
        result = result.trim() + '\n'
      }
    } else if (lastX !== null && (x - lastX) > 30) {
      // X坐标差距较大，可能是新段落或缩进
      result = result.trim() + '\n  '
    }

    // 添加当前文本
    result += text

    // 更新状态
    lastY = y
    lastX = x + (text.length * 10) // 估算文本宽度
    lastTextEndsWithSpace = text.endsWith(' ')
  }

  return result.trim()
}

// ⭐⭐⭐ 改进的PDF文本格式化函数 ⭐⭐⭐
const formatExtractedText = (text) => {
  if (!text) return ''

  console.log('原始PDF文本:', text.substring(0, 200) + '...')

  // 1. 基础清理
  let formatted = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, '  ')
      .replace(/[ \t]+/g, ' ')
      .replace(/^[ \t]+/gm, '')
      .replace(/[ \t]+$/gm, '')

  // 2. 智能分段 - 根据标点和行末判断
  const lines = formatted.split('\n')
  let result = []
  let currentParagraph = ''
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      // 空行：结束当前段落
      if (currentParagraph) {
        result.push(currentParagraph)
        currentParagraph = ''
      }
      inList = false
      continue
    }

    // 检测是否是标题或列表项
    const isTitle = line.match(/^[一二三四五六七八九十]、/) ||
        line.match(/^[0-9]+[\.、]/) ||
        line.match(/^第[一二三四五六七八九十]+[章节条项]/) ||
        line.match(/^[A-Za-z][\.\)]/)

    const isListItem = line.match(/^[•·●○◆■▶▷✓□]|\d+[\.\)）]/) ||
        line.match(/^[①②③④⑤⑥⑦⑧⑨⑩]/)

    if (isTitle || isListItem) {
      // 如果有未完成的段落，先保存
      if (currentParagraph) {
        result.push(currentParagraph)
        currentParagraph = ''
      }

      // 标题或列表项前面加空行（除非是连续列表）
      if (!inList || isTitle) {
        result.push('')
      }

      // 添加标题或列表项
      result.push(line)
      inList = true
    } else {
      // 普通文本行
      // 检查是否应该开始新段落
      const shouldStartNewParagraph =
          !currentParagraph ||
          line.match(/^[（【《「『]/) ||
          currentParagraph.endsWith('。') ||
          currentParagraph.endsWith('！') ||
          currentParagraph.endsWith('？') ||
          currentParagraph.endsWith(';') ||
          currentParagraph.endsWith('!') ||
          currentParagraph.endsWith('?')

      if (shouldStartNewParagraph && currentParagraph) {
        result.push(currentParagraph)
        currentParagraph = line
      } else {
        // 续接当前段落
        if (currentParagraph && !currentParagraph.endsWith(' ') && !line.startsWith(' ')) {
          currentParagraph += ' ' + line
        } else {
          currentParagraph += line
        }
      }

      // 行末检查：如果行末不是完整的中文句子，可能只是换行
      if (!line.match(/[。！？；.!?;"]$/)) {
        // 可能是同一段落内的换行，不加标点
        if (!currentParagraph.endsWith(' ')) {
          currentParagraph += ' '
        }
      }

      inList = false
    }
  }

  // 添加最后一个段落
  if (currentParagraph) {
    result.push(currentParagraph)
  }

  // 3. 合并结果并清理
  formatted = result.filter(line => line.trim()).join('\n\n')

  // 4. 修复常见的中文排版问题
  formatted = formatted
      .replace(/(\d)\s*([%‰℃°])/g, '$1$2')           // 数字和符号
      .replace(/([（【《「『])\s*/g, '$1')            // 左标点
      .replace(/\s*([）】》」』])/g, '$1')            // 右标点
      .replace(/([，、：；])\s*/g, '$1 ')            // 中文标点
      .replace(/([a-zA-Z])\s*([（(])/g, '$1$2')      // 英文和括号
      .replace(/([）)])\s*([a-zA-Z])/g, '$1$2')      // 括号和英文

  // 5. 清理多余的空行
  formatted = formatted.replace(/\n{3,}/g, '\n\n')

  // 6. 确保文档整洁
  formatted = formatted.trim() + '\n'

  console.log('格式化后文本:', formatted.substring(0, 200) + '...')
  return formatted
}

// 文件格式检测
const detectFileFormat = (arrayBuffer) => {
  const uint8 = new Uint8Array(arrayBuffer.slice(0, 8))

  // PDF文件头：%PDF-
  if (uint8[0] === 0x25 && uint8[1] === 0x50 && uint8[2] === 0x44 && uint8[3] === 0x46) {
    return 'pdf'
  }

  // DOCX是ZIP文件，前2字节是0x50 0x4B (PK)
  if (uint8[0] === 0x50 && uint8[1] === 0x4B) {
    return 'docx'
  }

  // 老格式DOC的OLE头
  if (uint8[0] === 0xD0 && uint8[1] === 0xCF && uint8[2] === 0x11 && uint8[3] === 0xE0) {
    return 'doc_old'
  }

  // RTF文件
  const header = String.fromCharCode(...uint8.slice(0, 6))
  if (header === '{\\rtf1') {
    return 'rtf'
  }

  return 'unknown'
}

// 处理文件上传
const handleFileUpload = async (e) => {
  const file = e.target.files[0]
  if (!file) return

  resetAllStates()
  fileName.value = file.name
  fileSize.value = formatFileSize(file.size)
  fileFormatInfo.value = ''
  showConvertTips.value = false
  pdfConversionTips.value = false

  isProcessing.value = true
  processingText.value = '正在读取文件...'

  try {
    const extension = getFileExtension(file.name).toLowerCase()
    console.log('上传文件:', file.name, '扩展名:', extension, '大小:', fileSize.value)

    // 读取为ArrayBuffer进行格式检测
    const arrayBuffer = await readFileAsArrayBuffer(file)
    const detectedFormat = detectFileFormat(arrayBuffer)
    console.log('检测到的文件格式:', detectedFormat, '扩展名:', extension)

    if (extension === 'txt' || extension === 'md') {
      // 处理文本文件
      processingText.value = '读取文本文件...'
      const text = await readTextFile(file)
      console.log('文本文件内容长度:', text.length)
      originText.value = cleanText(text)
      fileFormatInfo.value = `成功读取${extension.toUpperCase()}文件，共${text.length}个字符`
    }
    else if (extension === 'pdf' || detectedFormat === 'pdf') {
      // 处理PDF文件
      processingText.value = '解析PDF文档...'

      try {
        // 确保PDF.js已加载
        if (!pdfjsLib) {
          console.log('PDF.js未加载，正在加载...')
          await loadPdfJs()
        }

        const text = await parsePdfFile(arrayBuffer)
        console.log('PDF文件内容长度:', text.length)
        originText.value = cleanText(text)
        fileFormatInfo.value = `成功读取PDF文件，共${text.length}个字符`
      } catch (pdfError) {
        console.error('PDF解析失败:', pdfError)
        pdfConversionTips.value = true
        showConvertTips.value = true

        // 检查是否是技术问题
        if (pdfError.message.includes('Worker') || pdfError.message.includes('版本') || pdfError.message.includes('加载')) {
          errorMsg.value = 'PDF解析遇到技术问题，请参考下方的转换建议'
        } else {
          errorMsg.value = `PDF文件解析失败: ${pdfError.message}`
        }

        throw new Error('PDF文件解析失败')
      }
    }
    else if (extension === 'docx' || extension === 'doc') {
      // 处理Word文档
      processingText.value = '解析Word文档...'

      if (extension === 'doc' && detectedFormat === 'docx') {
        // 文件扩展名是.doc但实际上是.docx格式
        console.log('扩展名是.doc但实际是.docx格式')
        const text = await parseDocxFile(arrayBuffer)
        originText.value = cleanText(text)
        fileFormatInfo.value = `成功读取DOCX文件（扩展名误用为.doc），共${text.length}个字符`
      } else if (extension === 'doc' && detectedFormat === 'doc_old') {
        // 老格式DOC文件 - 上传到后端解析
        console.log('老格式DOC文件，上传到后端解析')

        try {
          processingText.value = '上传DOC文件到后端解析...'

          // 1. 创建FormData
          const formData = new FormData()
          formData.append('file', file)

          // 2. 上传到后端API - 仅解析，不进行AI检查
          const response = await axios.post('/api/check/ai?parse=true', formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            },
            timeout: 60000 // 60秒超时
          })

          console.log('后端响应:', response.data)

          // 3. 处理后端返回的结果
          if (response.data.success && response.data.data) {
            const data = response.data.data

            // 使用后端返回的文本
            originText.value = data.correctedText || data.originalText || ''

            if (originText.value) {
              fileFormatInfo.value = `✅ DOC文件解析成功，共${originText.value.length}个字符`
              // 仅解析模式下，不显示错误信息
              aiErrors.value = []
              showAISection.value = false
            } else {
              errorMsg.value = '后端解析的文本为空'
            }
          } else {
            errorMsg.value = response.data.message || '后端解析失败'
          }

        } catch (uploadError) {
          console.error('上传到后端失败:', uploadError)
          showConvertTips.value = true
          errorMsg.value = `上传到后端失败: ${uploadError.message || '网络错误'}`
          throw new Error('DOC文件解析失败')
        }
      } else if (detectedFormat === 'docx') {
        // 标准DOCX文件
        console.log('标准DOCX文件')
        const text = await parseDocxFile(arrayBuffer)
        originText.value = cleanText(text)
        fileFormatInfo.value = `成功读取DOCX文件，共${text.length}个字符`
      } else if (detectedFormat === 'rtf') {
        console.log('RTF格式文件')
        showConvertTips.value = true
        throw new Error('RTF格式文件需要转换为DOCX格式')
      } else {
        console.log('未知或损坏的文件格式')
        throw new Error('文件格式不支持或文件已损坏')
      }
    } else {
      errorMsg.value = '不支持的文件格式，请选择TXT、PDF、DOC或DOCX文件'
      isProcessing.value = false
      return
    }

    console.log('最终文本长度:', originText.value.length)
    if (!originText.value.trim()) {
      errorMsg.value = '文件内容为空'
    }
  } catch (err) {
    console.error('文件读取失败:', err)
    if (!errorMsg.value) {
      errorMsg.value = err.message || '文件读取失败'
    }

    originText.value = ''
  } finally {
    isProcessing.value = false
  }
}

// 添加PDF解析函数
const parsePdfFile = async (arrayBuffer) => {
  try {
    console.log('开始解析PDF，文件大小:', arrayBuffer.byteLength)

    // 确保pdfjsLib可用
    if (!pdfjsLib || !pdfjsLib.getDocument) {
      throw new Error('PDF.js未正确加载')
    }

    // ⭐⭐⭐ 关键：强制使用无worker模式 ⭐⭐⭐
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      disableWorker: true,  // 强制禁用worker
      useWorkerFetch: false, // 禁用worker fetch
      isEvalSupported: false // 禁用eval支持
    })

    const pdf = await loadingTask.promise

    console.log(`PDF总页数: ${pdf.numPages}`)

    let fullText = ''
    const maxPages = Math.min(pdf.numPages, 50)

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      processingText.value = `正在解析PDF第 ${pageNum}/${pdf.numPages} 页...`

      const page = await pdf.getPage(pageNum)
      const textContent = await page.getTextContent()

      // ⭐⭐⭐ 使用改进的文本提取方法 ⭐⭐⭐
      const pageText = extractTextWithFormat(textContent.items)

      // 对每页文本进行基础清理
      const cleanedPageText = pageText
          .replace(/\s+/g, ' ')
          .trim()

      // 只有当页面有内容时才添加
      if (cleanedPageText) {
        fullText += cleanedPageText + '\n\n'
      }

      // 如果文件太大，提前停止
      if (fullText.length > 500000) {
        fullText += '...（文件内容过长，已截断）'
        break
      }
    }

    if (!fullText.trim()) {
      throw new Error('PDF文档内容为空或无法提取文本')
    }

    console.log('PDF解析完成，总字符数:', fullText.length)

    // ⭐⭐⭐ 应用文本格式化 ⭐⭐⭐
    const formattedText = formatExtractedText(fullText)
    return formattedText

  } catch (err) {
    console.error('PDF解析详细错误:', err)

    // 提供更详细的错误信息
    if (err.name === 'InvalidPDFException') {
      throw new Error('PDF文件格式无效或已损坏')
    } else if (err.message.includes('password')) {
      throw new Error('PDF文件受密码保护，无法读取')
    } else if (err.message.includes('Worker')) {
      // 如果还是worker错误，尝试最简化的方法
      console.warn('Worker错误，尝试备用方法')
      try {
        return await parsePdfSimple(arrayBuffer)
      } catch (simpleError) {
        throw new Error(`PDF文件解析失败: ${simpleError.message}`)
      }
    } else {
      throw new Error(`PDF文件解析失败: ${err.message}`)
    }
  }
}

// ⭐⭐⭐ 添加一个最简单的PDF解析备用方法 ⭐⭐⭐
const parsePdfSimple = async (arrayBuffer) => {
  console.log('使用最简化方法解析PDF')

  try {
    // 创建一个临时URL
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)

    // 使用最简化的配置
    const loadingTask = pdfjsLib.getDocument({
      url: url,
      disableWorker: true,
      verbosity: 0  // 最小化日志
    })

    const pdf = await loadingTask.promise

    let fullText = ''
    const maxPages = Math.min(pdf.numPages, 10)  // 只解析前10页

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const textContent = await page.getTextContent()

      const pageText = textContent.items
          .map(item => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()

      if (pageText) {
        fullText += pageText + '\n\n'
      }

      if (fullText.length > 100000) {
        fullText += '...（文件内容过长，已截断）'
        break
      }
    }

    // 清理临时URL
    URL.revokeObjectURL(url)

    if (!fullText.trim()) {
      throw new Error('PDF文档内容为空')
    }

    return fullText

  } catch (err) {
    console.error('最简化方法也失败:', err)
    throw err
  }
}

// 读取文件为ArrayBuffer
const readFileAsArrayBuffer = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(event.target.result)
    reader.onerror = (error) => reject(new Error(`文件读取错误: ${error.message}`))
    reader.readAsArrayBuffer(file)
  })
}

// 读取文本文件
const readTextFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        resolve(event.target.result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = (error) => reject(error)
    reader.readAsText(file, 'UTF-8')
  })
}

// 解析DOCX文件
const parseDocxFile = async (arrayBuffer) => {
  try {
    console.log('开始解析DOCX，文件大小:', arrayBuffer.byteLength)

    // 使用mammoth解析Word文档
    const result = await mammoth.extractRawText({
      arrayBuffer: arrayBuffer,
      includeEmbeddedStyleMap: false,
      includeDefaultStyleMap: false
    })

    console.log('mammoth解析结果:', {
      valueLength: result.value?.length || 0,
      hasValue: !!result.value,
      messages: result.messages || []
    })

    // 如果没有内容，尝试其他方法
    if (!result.value || !result.value.trim()) {
      throw new Error('Word文档内容为空或格式特殊')
    }

    return result.value
  } catch (err) {
    console.error('DOCX解析详细错误:', err)
    throw new Error(`Word文件解析失败: ${err.message}`)
  }
}

// 清理文本
const cleanText = (text) => {
  if (!text) return ''

  return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/^[ \t]+/gm, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 获取文件扩展名
const getFileExtension = (filename) => {
  return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2)
}

// 获取文件类型样式类
const getFileTypeClass = (filename) => {
  const ext = getFileExtension(filename).toLowerCase()
  switch (ext) {
    case 'txt':
      return 'file-type-txt'
    case 'md':
      return 'file-type-md'
    case 'doc':
      return 'file-type-doc'
    case 'docx':
      return 'file-type-docx'
    case 'pdf':
      return 'file-type-pdf'
    default:
      return 'file-type-other'
  }
}

// 重置状态
const resetAllStates = () => {
  originText.value = ''
  selectedCorrectedText.value = ''
  errorMsg.value = ''
  aiErrors.value = []
  isChecking.value = false
  isProcessing.value = false
  fileName.value = ''
  fileSize.value = ''
  fileFormatInfo.value = ''
  showConvertTips.value = false
  showAISection.value = false
  pdfConversionTips.value = false
  knownTyposCount.value = ''
  
  // 重置搜索状态
  searchKeyword.value = ''
  searchResults.value = []
  currentSearchIndex.value = -1

  // 重置文件输入
  const fileInput = document.getElementById('fileInput')
  if (fileInput) {
    fileInput.value = ''
  }
}

// 开始检查错别字 - 分段 AI 深度审校
const startCheck = async () => {
  if (!originText.value || isChecking.value) return
  isChecking.value = true
  errorMsg.value = ''
  aiErrors.value = []
  selectedCorrectedText.value = ''
  showAISection.value = true

  let backendErrors = []

  try {
    // 1. 如果有新上传的文件，先获取其最新解析出的文本
    const fileInput = document.getElementById('fileInput')
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0]
      const extension = getFileExtension(file.name).toLowerCase()

      if (['doc', 'docx', 'pdf'].includes(extension)) {
        processingText.value = '正在解析文档内容...'

        const formData = new FormData()
        formData.append('file', file)
        formData.append('parse', 'true') 

        try {
          const response = await axios.post('/api/check/ai', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000
          })

          if (response.data.success && response.data.data) {
            const text = response.data.data.originalText
            if (text) {
              originText.value = cleanText(text)
            }
          }
        } catch (e) {
          console.warn('后端解析失败，使用前端解析结果或继续')
        }
      }
    }

    // 2. 调用后端规则检查 (作为基础保障)
    try {
      const ruleResponse = await axios.post('/api/check/manual', {
        text: originText.value
      })
      if (ruleResponse.data.success) {
        backendErrors = ruleResponse.data.data.errors || []
      }
    } catch (e) {
      console.warn('基础规则检查不可用')
    }

    // 3. 调用 pycorrector 服务
    let pycorrectorErrors = []
    try {
      processingText.value = '正在调用 pycorrector 纠错服务...'
      console.log('[pycorrector] 正在请求 pycorrector 服务...')
      const pycResponse = await axios.post('/api/correct', {
        text: originText.value
      }, {
        timeout: 30000
      })
      if (pycResponse.data && Array.isArray(pycResponse.data.errors)) {
        pycorrectorErrors = pycResponse.data.errors
        console.log(`[pycorrector] 返回错别字数量: ${pycorrectorErrors.length}`)
      }
    } catch (e) {
      console.warn('[pycorrector] 服务调用失败:', e.message)
    }

    // 4. 分段调用 AI 进行深度审校
    const MAX_CHUNK_SIZE = 1500 
    const chunks = []
    for (let i = 0; i < originText.value.length; i += MAX_CHUNK_SIZE) {
      chunks.push(originText.value.substring(i, i + MAX_CHUNK_SIZE))
    }

    const allAiErrors = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const offset = i * MAX_CHUNK_SIZE
      processingText.value = `AI 深度审校中 (${i + 1}/${chunks.length})...`
      
      const promptText = `你是一名严格的中文错别字校对员，只做文字纠错，不做任何润色或优化。

### 严格规则：
1. 只识别以下类型的错误：
   - 同音字误用（如：因该→应该、以经→已经）
   - 形近字错误（如：辩认→辨认、既使→即使）
   - OCR识别错误（如：咳血评估→科学评估）
   - 成语俗语错误（如：再接再励→再接再厉）
2. 以下情况**绝对不要报告**：
   - 语句优化建议
   - 用词风格改进
   - 标点符号规范（除非明显错误）
   - 语法优化建议
3. **有错才报，无错不报**！如果没有发现错别字，返回空数组 []
4. **必须返回JSON数组**，不能返回单个对象

### 输出格式：
只返回JSON数组，不要其他任何内容。格式如下：
[
  {"errorWord":"错误词","correctWord":"正确词","reason":"错误原因"}
]

如果没有错误，返回：
[]

### 待校对文本：
${chunk}`

      try {
        const response = await axios.post('/api/ollama/generate', {
          model: 'qwen3:30b',
          prompt: promptText,
          temperature: 0.1,
          max_tokens: 2000,
          stream: false,
          format: "json"
        }, {
          timeout: 90000,
          headers: { 'Content-Type': 'application/json' }
        })

        console.log(`[AI] 片段 ${i + 1} 检查完成`)
        console.log(`[AI] 原始响应:`, response.data)
        
        let data = response.data?.response || response.data
        console.log(`[AI] 处理前数据:`, data)
        
        data = data.replace(/```json\n?|\n?```/g, '').trim()
        console.log(`[AI] 清理后数据:`, data)
        
        const parsed = JSON.parse(data)
        console.log(`[AI] 解析后数据:`, parsed)
        
        // 兼容各种返回格式
        let rawErrors = []
        if (Array.isArray(parsed)) {
          rawErrors = parsed
        } else if (Array.isArray(parsed.errors)) {
          rawErrors = parsed.errors
        } else if (parsed.errorWord && parsed.correctWord) {
          // 单个错误对象
          rawErrors = [parsed]
        } else {
          rawErrors = []
        }
        
        console.log(`[AI] 错误列表:`, rawErrors)
        
        if (rawErrors.length > 0) {
          console.log(`[AI] 片段 ${i + 1} 发现 ${rawErrors.length} 个错误`)
        }
        
        rawErrors.forEach(error => {
          const { errorWord, correctWord, reason } = error
          
          // 验证：必须有错误词和正确词，且不能相同
          if (!errorWord || !correctWord || errorWord === correctWord) {
            console.log(`[AI] 跳过无效错误:`, error)
            return
          }
          
          // 在当前片段中查找
          let pos = chunk.indexOf(errorWord)
          if (pos !== -1) {
            allAiErrors.push({
              position: offset + pos,
              errorWord: errorWord,
              correctWord: correctWord,
              reason: reason || 'AI 语义识别'
            })
          } else {
            // 在整个文本中查找
            const globalPos = originText.value.indexOf(errorWord)
            if (globalPos !== -1) {
              allAiErrors.push({
                position: globalPos,
                errorWord: errorWord,
                correctWord: correctWord,
                reason: reason || 'AI 语义识别'
              })
            } else {
              // AI 幻觉：文本中不存在这个词
              console.warn(`[AI] 幻觉警告：在文本中未找到错误词 "${errorWord}"，跳过`)
            }
          }
        })
      } catch (e) {
        console.error(`[AI] 片段 ${i + 1} 审校失败:`, e)
        // 这个片段失败了，继续处理下一个
      }
    }

    // 合并错误 (AI > pycorrector > Rule 优先级)
    const finalErrors = []
    const seenPositions = new Set()

    // AI 结果优先
    allAiErrors.forEach(err => {
      if (!seenPositions.has(err.position)) {
        finalErrors.push({ ...err, source: 'AI', isSelected: true })
        seenPositions.add(err.position)
      }
    })

    // pycorrector 结果（去重）
    pycorrectorErrors.forEach(pyc => {
      if (!seenPositions.has(pyc.position)) {
        finalErrors.push({ ...pyc, source: 'Pycorrector', isSelected: true })
        seenPositions.add(pyc.position)
      }
    })

    // 规则库结果（去重）
    backendErrors.forEach(be => {
      if (!seenPositions.has(be.position)) {
        finalErrors.push({ ...be, source: 'Rule', isSelected: true })
        seenPositions.add(be.position)
      }
    })

    aiErrors.value = finalErrors.sort((a, b) => a.position - b.position)
    updateSelectedCorrection()

    if (aiErrors.value.length > 0) {
      errorMsg.value = `✅ 审校完成，共发现 ${aiErrors.value.length} 处错误`
    } else {
      errorMsg.value = '✅ 未发现明显错误'
    }

  } catch (e) {
    console.error('审校流程异常:', e)
    errorMsg.value = `检查失败: ${e.message}`
  } finally {
    isChecking.value = false
  }
}

// 智能验证和定位错误
const validateAndLocateErrors = (rawErrors) => {
  if (!rawErrors || !Array.isArray(rawErrors)) return []

  const text = originText.value
  const validatedErrors = []

  rawErrors.forEach((error, index) => {
    const { errorWord, correctWord, reason } = error

    if (!errorWord || !correctWord || errorWord === correctWord) {
      console.warn(`错误${index + 1}: 无效的错误词/正确词`, error)
      return
    }

    // 1. 精确查找
    let position = text.indexOf(errorWord)

    // 2. 如果精确查找失败，尝试从当前位置开始查找
    if (position === -1) {
      // 可能前面有相同的词，我们需要找到正确的那一个
      let searchPos = 0
      let foundCount = 0

      // 查找所有出现的位置
      while ((searchPos = text.indexOf(errorWord, searchPos)) !== -1) {
        foundCount++

        // 检查这个位置是否已经被其他修正使用
        const isAlreadyUsed = validatedErrors.some(e =>
            searchPos >= e.position && searchPos < e.position + e.errorWord.length
        )

        if (!isAlreadyUsed) {
          position = searchPos
          break
        }

        searchPos += errorWord.length
      }
    }

    // 3. 验证位置和文本
    if (position !== -1) {
      const actualText = text.substr(position, errorWord.length)

      // 检查是否与已有错误重叠
      const isOverlap = validatedErrors.some(e =>
          position >= e.position && position < e.position + e.errorWord.length ||
          e.position >= position && e.position < position + actualText.length
      )

      if (!isOverlap && isValidCorrection(actualText, errorWord, correctWord)) {
        validatedErrors.push({
          position: position,
          errorWord: actualText,
          correctWord: correctWord,
          reason: reason || '错别字'
        })
      }
    } else {
      console.warn(`错误${index + 1}: 未找到错误词 "${errorWord}"`)
    }
  })

  return validatedErrors.sort((a, b) => a.position - b.position)
}

// 检查修正是否合理
const isValidCorrection = (actualText, errorWord, correctWord) => {
  if (actualText === correctWord) return false

  const lengthDiff = Math.abs(correctWord.length - actualText.length)
  if (lengthDiff > Math.max(2, actualText.length * 0.5)) {
    console.warn(`修正长度差异过大: "${actualText}" -> "${correctWord}"`)
    return false
  }

  return true
}

// 在文本中查找错误词
const findErrorWordInText = (text, errorWord, correctWord) => {
  if (!text || !errorWord || errorWord.length < 1) return -1

  let position = text.indexOf(errorWord)
  if (position !== -1) return position

  // 查找相似词
  for (let i = 0; i <= text.length - 2; i++) {
    for (let len = Math.max(2, errorWord.length - 2); len <= Math.min(errorWord.length + 2, text.length - i); len++) {
      const substring = text.substr(i, len)

      const similarity = calculateSimilarity(substring, errorWord)
      if (similarity > 0.7) {
        if (isValidWordBoundary(text, i, len)) {
          console.log(`找到相似词: "${substring}" 相似于 "${errorWord}" (${similarity})`)
          return i
        }
      }
    }
  }

  return -1
}

// 计算字符串相似度
const calculateSimilarity = (str1, str2) => {
  const set1 = new Set(str1)
  const set2 = new Set(str2)
  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])
  return intersection.size / union.size
}

// 检查是否是有效的单词边界
const isValidWordBoundary = (text, position, length) => {
  const isStartBoundary = position === 0 ||
      /[\s.,，。!?！？:：;；"'「」『』()（）【】《》]/.test(text[position - 1])

  const isEndBoundary = position + length >= text.length ||
      /[\s.,，。!?！？:：;；"'「」『』()（）【】《》]/.test(text[position + length])

  return isStartBoundary || isEndBoundary
}

// 搜索功能相关方法
const performSearch = () => {
  searchResults.value = []
  currentSearchIndex.value = -1
  
  if (!searchKeyword.value || !originText.value) return

  const keyword = searchKeyword.value
  const text = originText.value
  let pos = text.indexOf(keyword)
  
  while (pos !== -1) {
    searchResults.value.push({
      start: pos,
      end: pos + keyword.length
    })
    pos = text.indexOf(keyword, pos + 1)
  }

  if (searchResults.value.length > 0) {
    currentSearchIndex.value = 0
    scrollToSearchMatch()
  }
}

const nextSearchMatch = () => {
  if (searchResults.value.length === 0) return
  
  if (currentSearchIndex.value < searchResults.value.length - 1) {
    currentSearchIndex.value++
  } else {
    currentSearchIndex.value = 0 // 循环回到第一个
  }
  scrollToSearchMatch()
}

const prevSearchMatch = () => {
  if (searchResults.value.length === 0) return
  
  if (currentSearchIndex.value > 0) {
    currentSearchIndex.value--
  } else {
    currentSearchIndex.value = searchResults.value.length - 1 // 循环回到最后一个
  }
  scrollToSearchMatch()
}

const scrollToSearchMatch = () => {
  if (currentSearchIndex.value === -1 || !searchResults.value[currentSearchIndex.value]) return
  
  const match = searchResults.value[currentSearchIndex.value]
  scrollToPosition(match.start)
}

const getSearchClass = (position) => {
  if (searchResults.value.length === 0) return ''
  
  // 检查是否在当前选中的搜索结果中
  if (currentSearchIndex.value !== -1) {
    const currentMatch = searchResults.value[currentSearchIndex.value]
    if (position >= currentMatch.start && position < currentMatch.end) {
      return 'search-current'
    }
  }
  
  // 检查是否在其他搜索结果中
  for (const match of searchResults.value) {
    if (position >= match.start && position < match.end) {
      return 'search-match'
    }
  }
  
  return ''
}

// 获取错误上下文（返回HTML格式）
const getErrorContext = (position, length) => {
  if (position < 0 || position >= originText.value.length) return ''

  const start = Math.max(0, position - 20)
  const end = Math.min(originText.value.length, position + length + 20)
  const context = originText.value.substring(start, end)

  // 标记错误部分（使用内联样式确保高亮生效）
  const errorStart = position - start
  const errorEnd = errorStart + length
  const beforeError = context.substring(0, errorStart)
  const errorText = context.substring(errorStart, errorEnd)
  const afterError = context.substring(errorEnd)

  return `${beforeError}<span style="background-color: #ffeeba; color: #856404; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin: 0 2px; border: 1px solid #f5c6cb;">${errorText}</span>${afterError}`
}

// 复制错误上下文到剪贴板
const copyErrorInfo = async (error) => {
  const context = getErrorContextPlain(error.position, error.errorWord.length)
  try {
    await navigator.clipboard.writeText(context)
    showCopyToast()
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 获取纯文本格式的上下文（用于复制，不添加任何标记）
const getErrorContextPlain = (position, length) => {
  if (position < 0 || position >= originText.value.length) return ''

  const start = Math.max(0, position - 20)
  const end = Math.min(originText.value.length, position + length + 20)
  return originText.value.substring(start, end)
}

// 显示复制成功提示
const showCopyToast = () => {
  copyToastVisible.value = true
  setTimeout(() => {
    copyToastVisible.value = false
  }, 2000)
}

const copyToastVisible = ref(false)

// 获取字符的错误类
const getCharErrorClass = (position) => {
  if (showAISection.value) {
    // 只显示AI识别的错误（包括选中的和未选中的）
    for (const error of aiErrors.value) {
      if (position >= error.position &&
          position < error.position + error.errorWord.length) {
        return error.isSelected ? 'ai-error-char' : 'ai-error-char-unselected'
      }
    }
  }

  return ''
}

// 获取字符提示
const getCharTooltip = (position) => {
  if (showAISection.value) {
    for (const error of aiErrors.value) {
      if (position >= error.position &&
          position < error.position + error.errorWord.length) {
        const selectionStatus = error.isSelected ? '（已选中）' : '（未选中）'
        return `AI识别：${error.errorWord} → ${error.correctWord} (${error.reason})${selectionStatus}`
      }
    }
  }

  return null
}

// 点击字符处理
const handleCharClick = (position) => {
  scrollToPosition(position)
}

// 滚动到指定位置
const scrollToPosition = async (position) => {
  await nextTick()

  if (!originRef.value) return

  // 找到对应的行
  let lineElement = null
  const lines = originRef.value.querySelectorAll('.text-line')
  let currentPos = 0

  for (const line of lines) {
    const lineLength = line.textContent.length
    if (position >= currentPos && position < currentPos + lineLength) {
      lineElement = line
      break
    }
    currentPos += lineLength + 1
  }

  if (lineElement) {
    lineElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })

    // 临时高亮
    lineElement.classList.add('highlight-line')
    setTimeout(() => {
      lineElement.classList.remove('highlight-line')
    }, 2000)
  }
}

// 复制文本到剪贴板
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    errorMsg.value = '已复制到剪贴板'
    setTimeout(() => {
      errorMsg.value = ''
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
    errorMsg.value = '复制失败：' + err.message
  }
}

// 导出文本文件
const exportText = (text, prefix) => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${prefix}_${fileName.value || 'document'}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 切换错误选择状态
const toggleErrorSelection = (index) => {
  aiErrors.value[index].isSelected = !aiErrors.value[index].isSelected
  // 触发响应式更新
  aiErrors.value = [...aiErrors.value]
}

// 全选所有错误
const selectAllErrors = () => {
  aiErrors.value = aiErrors.value.map(error => ({
    ...error,
    isSelected: true
  }))
  updateSelectedCorrection()
}

// 取消全选所有错误
const deselectAllErrors = () => {
  aiErrors.value = aiErrors.value.map(error => ({
    ...error,
    isSelected: false
  }))
  updateSelectedCorrection()
}

// 更新选中修正的预览
const updateSelectedCorrection = () => {
  applySelectedCorrectionsToText()
  errorMsg.value = `已更新预览，选中了 ${selectedErrorCount.value} 处修正`
  setTimeout(() => {
    errorMsg.value = ''
  }, 2000)
}

// 应用选中的AI修正
const applySelectedCorrections = () => {
  if (selectedErrorCount.value === 0) {
    errorMsg.value = '请先选择要修正的错误'
    return
  }

  // 应用选中的修正到原文
  const selectedErrors = aiErrors.value.filter(error => error.isSelected)
  originText.value = applyCorrectionsToText(selectedErrors)

  // 重置状态
  aiErrors.value = []
  selectedCorrectedText.value = ''
  showAISection.value = false

  errorMsg.value = `✅ 已应用 ${selectedErrorCount.value} 处选中的修正`

  setTimeout(() => {
    errorMsg.value = ''
  }, 3000)
}
</script>

<style scoped>
/* 基础样式 */
.app-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.title {
  text-align: center;
  color: #2c3e50;
  margin-bottom: 10px;
  padding-bottom: 15px;
  border-bottom: 2px solid #eee;
  font-size: 28px;
}

.subtitle {
  text-align: center;
  color: #7f8c8d;
  margin-bottom: 30px;
  font-size: 16px;
  font-weight: normal;
}

.upload-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 25px;
  padding: 25px;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  border-radius: 12px;
  border: 2px solid #e0e0e0;
}

.file-input-container {
  position: relative;
}

.file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.file-input-label {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  background: white;
  border: 2px dashed #4a90e2;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 16px;
  color: #4a90e2;
  font-weight: 500;
}

.file-input-label:hover {
  background: #f0f7ff;
  border-color: #357abd;
}

.upload-icon {
  width: 24px;
  height: 24px;
  fill: currentColor;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 16px;
  background: white;
  border-radius: 6px;
  border-left: 4px solid #4a90e2;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.file-name {
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.file-size {
  color: #666;
  font-size: 14px;
}

.file-type-badge {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: bold;
  color: white;
  text-transform: uppercase;
}

.file-type-txt {
  background: #3498db;
}

.file-type-md {
  background: #9b59b6;
}

.file-type-doc {
  background: #2ecc71;
}

.file-type-docx {
  background: #e74c3c;
}

.file-type-pdf {
  background: #e74c3c;
}

.file-type-other {
  background: #95a5a6;
}

.button-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.check-btn, .manual-btn, .reset-btn {
  padding: 12px 28px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 500;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
  justify-content: center;
}

.check-btn {
  background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
}

.check-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(74, 144, 226, 0.4);
}

.check-btn:disabled {
  background: #cccccc;
  cursor: not-allowed;
  box-shadow: none;
}

.manual-btn {
  background: linear-gradient(135deg, #f5a623 0%, #d48c1a 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(245, 166, 35, 0.3);
}

.manual-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(245, 166, 35, 0.4);
}

.reset-btn {
  background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(149, 165, 166, 0.3);
}

.reset-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(149, 165, 166, 0.4);
}

.processing-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  margin: 20px 0;
  border: 2px dashed #4a90e2;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #4a90e2;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-spinner.large {
  width: 40px;
  height: 40px;
  border-width: 4px;
  margin-bottom: 15px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.processing-text {
  margin-top: 10px;
  color: #4a90e2;
  font-size: 16px;
  font-weight: 500;
}

.error-msg {
  padding: 16px 20px;
  margin: 15px 0;
  border-radius: 8px;
  font-size: 14px;
  animation: slideIn 0.3s ease;
}

.error-msg:not(:empty) {
  background: linear-gradient(135deg, #fff3f3 0%, #ffeaea 100%);
  color: #e74c3c;
  border-left: 4px solid #e74c3c;
  box-shadow: 0 2px 8px rgba(231, 76, 60, 0.1);
}

.format-info {
  background: linear-gradient(135deg, #e8f4fd 0%, #d4eafc 100%);
  border-radius: 12px;
  padding: 20px;
  margin: 20px 0;
  border-left: 4px solid #4a90e2;
  animation: slideIn 0.3s ease;
}

.format-info-content {
  display: flex;
  align-items: flex-start;
  gap: 15px;
}

.format-icon {
  font-size: 24px;
  margin-top: 2px;
}

.format-details {
  flex: 1;
}

.format-text {
  font-size: 15px;
  color: #2c3e50;
  font-weight: 500;
  margin-bottom: 10px;
}

.convert-tips {
  background: white;
  border-radius: 8px;
  padding: 15px;
  margin-top: 10px;
  border: 1px solid #d4eafc;
}

.convert-tips p {
  margin: 0 0 10px 0;
  color: #2c3e50;
}

.convert-tips ul {
  margin: 0;
  padding-left: 20px;
  color: #555;
}

.convert-tips li {
  margin-bottom: 8px;
  line-height: 1.5;
}

.convert-tips a {
  color: #4a90e2;
  text-decoration: none;
}

.convert-tips a:hover {
  text-decoration: underline;
}

.manual-results {
  background: linear-gradient(135deg, #fff8e6 0%, #fff3d1 100%);
  border-radius: 12px;
  padding: 25px;
  margin: 25px 0;
  border-left: 4px solid #f5a623;
  box-shadow: 0 4px 12px rgba(245, 166, 35, 0.1);
  animation: slideIn 0.3s ease;
}

.result-icon, .panel-icon {
  margin-right: 10px;
}

.manual-results h3 {
  margin: 0 0 20px 0;
  color: #d48c1a;
  font-size: 20px;
  display: flex;
  align-items: center;
}

.compare-container {
  display: flex;
  gap: 25px;
  margin-bottom: 35px;
  animation: slideIn 0.3s ease;
}

@media (max-width: 1024px) {
  .compare-container {
    flex-direction: column;
  }
}

.doc-panel {
  flex: 1;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  transition: transform 0.3s;
}

.doc-panel:hover {
  transform: translateY(-5px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.12);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 25px;
  background: linear-gradient(135deg, #f9f9f9 0%, #f0f0f0 100%);
  border-bottom: 1px solid #e8e8e8;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  color: #2c3e50;
  display: flex;
  align-items: center;
}

.error-count {
  margin-left: 12px;
  font-size: 14px;
  color: #e74c3c;
  background: #ffeaea;
  padding: 4px 10px;
  border-radius: 20px;
  font-weight: 500;
}

.panel-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: white;
  color: #666;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.action-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
}

.action-btn.apply-btn {
  background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
  color: white;
}

.text-content {
  padding: 25px;
  line-height: 1.8;
  font-size: 15px;
  color: #333;
  max-height: 600px;
  overflow-y: auto;
  background: #fdfdfd;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, 'Courier New', monospace;
}

.text-line {
  min-height: 1.8em;
  padding: 2px 0;
  position: relative;
  white-space: pre-wrap;
  word-break: break-word;
}

.char-item {
  display: inline-block;
  padding: 0 1px;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.2s;
  position: relative;
}

.char-item:hover {
  background: #e8f4fc;
  transform: scale(1.05);
}

/* AI识别错误样式 */
.ai-error-char {
  color: #e74c3c;
  background: linear-gradient(135deg, rgba(231, 76, 60, 0.2), rgba(231, 76, 60, 0.3));
  font-weight: 600;
  border-bottom: 2px solid #e74c3c;
  position: relative;
  border-radius: 2px;
  padding: 0 1px;
  margin: 0 1px;
  animation: aiErrorPulse 2s infinite;
  z-index: 1;
}

@keyframes aiErrorPulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.4);
  }
  50% {
    opacity: 0.9;
    box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.2);
  }
}

/* 未选中的AI错误字符样式 */
.ai-error-char-unselected {
  color: #ff9f43;
  background: linear-gradient(135deg, rgba(255, 159, 67, 0.2), rgba(255, 159, 67, 0.3));
  font-weight: 600;
  border-bottom: 2px dotted #ff9f43;
  position: relative;
  border-radius: 2px;
  padding: 0 1px;
  margin: 0 1px;
  animation: unselectedPulse 2s infinite;
  z-index: 1;
}

@keyframes unselectedPulse {
  0%, 100% {
    opacity: 0.7;
    box-shadow: 0 0 0 0 rgba(255, 159, 67, 0.2);
  }
  50% {
    opacity: 0.9;
    box-shadow: 0 0 0 2px rgba(255, 159, 67, 0.1);
  }
}

/* 修正后字符样式 */
.corrected-char {
  color: #27ae60 !important;
  background: linear-gradient(135deg, rgba(39, 174, 96, 0.2), rgba(39, 174, 96, 0.3)) !important;
  font-weight: 600 !important;
  border-bottom: 2px solid #27ae60 !important;
  position: relative;
  border-radius: 2px;
  padding: 0 1px !important;
  margin: 0 1px !important;
  animation: correctedPulse 2s infinite !important;
  z-index: 1;
}

@keyframes correctedPulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(39, 174, 96, 0.4);
  }
  50% {
    opacity: 0.9;
    box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.2);
  }
}

/* 修正后字符的hover效果 */
.corrected-char:hover {
  background: linear-gradient(135deg, rgba(39, 174, 96, 0.3), rgba(39, 174, 96, 0.4)) !important;
  transform: scale(1.1) !important;
  z-index: 10 !important;
  box-shadow: 0 4px 8px rgba(39, 174, 96, 0.3) !important;
}

.highlight-line {
  animation: highlight 2s ease;
  background: linear-gradient(90deg,
  rgba(255, 243, 224, 0.4) 0%,
  rgba(255, 243, 224, 0.8) 50%,
  rgba(255, 243, 224, 0.4) 100%
  );
}

@keyframes highlight {
  0%, 100% {
    background-color: transparent;
    background-image: none;
  }
  50% {
    background-color: #fff3e0;
    background-image: linear-gradient(90deg,
    rgba(255, 243, 224, 0.4) 0%,
    rgba(255, 243, 224, 0.8) 50%,
    rgba(255, 243, 224, 0.4) 100%
    );
  }
}

.error-list {
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.08);
  margin-top: 25px;
  overflow: hidden;
  animation: slideIn 0.3s ease;
}

/* 选择控制区域 */
.selection-controls {
  padding: 25px;
  background: linear-gradient(135deg, #f9f9f9 0%, #f0f0f0 100%);
  border-bottom: 1px solid #e8e8e8;
}

.selection-controls h3 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.selection-info {
  font-size: 14px;
  color: #e74c3c;
  background: #ffeaea;
  padding: 4px 10px;
  border-radius: 20px;
  font-weight: 500;
}

.selection-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.selection-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.select-all-btn {
  background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
  color: white;
}

.deselect-all-btn {
  background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
  color: white;
}

.apply-selected-btn {
  background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
  color: white;
}

.update-correction-btn {
  background: linear-gradient(135deg, #f5a623 0%, #d48c1a 100%);
  color: white;
}

.selection-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.checkbox-icon {
  font-size: 16px;
}

.error-scroll-container {
  max-height: 400px;
  overflow-y: auto;
  padding: 0 25px 25px;
}

/* 错误项样式 */
.error-item {
  position: relative;
  padding: 18px 18px 18px 50px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  transition: all 0.3s;
  border-radius: 8px;
  margin: 10px 0;
  background: #fdfdfd;
}

.error-item.selected-error {
  background: linear-gradient(135deg, #e8f4fc 0%, #d4eafc 100%);
  border-left: 4px solid #4a90e2;
}

.ai-error-item {
  border-left: 4px solid #e74c3c;
}

.ai-error-item.selected-error {
  border-left: 4px solid #4a90e2;
}

.error-checkbox {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  z-index: 10;
}

.checkbox-input {
  display: block;
  width: 20px;
  height: 20px;
  cursor: pointer;
  opacity: 0;
  position: absolute;
  z-index: 11;
}

.checkbox-label {
  display: block;
  width: 20px;
  height: 20px;
  border: 2px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
  background: white;
}

.checkbox-label:hover {
  border-color: #4a90e2;
}

.checkbox-input:checked + .checkbox-label {
  background: #4a90e2;
  border-color: #4a90e2;
}

.checkbox-input:checked + .checkbox-label::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 14px;
  font-weight: bold;
}

.error-content-wrapper {
  flex: 1;
  cursor: pointer;
}

.error-item:hover {
  background: #f5f9ff;
  transform: translateX(5px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.error-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.error-index {
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.ai-error-item .error-index {
  background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
}

.manual-error-item .error-index {
  background: linear-gradient(135deg, #f39c12 0%, #d68910 100%);
}

.error-location {
  font-size: 13px;
  color: #666;
  background: #f0f0f0;
  padding: 4px 10px;
  border-radius: 4px;
}

.error-type {
  font-size: 12px;
  background: #f0f0f0;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 500;
}

.ai-error-item .error-type {
  color: #e74c3c;
}

.manual-error-item .error-type {
  color: #f39c12;
}

.error-content {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.error-word {
  font-weight: bold;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.ai-error-item .error-word {
  color: #e74c3c;
  background: linear-gradient(135deg, #ffeaea 0%, #ffd6d6 100%);
}

.manual-error-item .error-word {
  color: #f39c12;
  background: linear-gradient(135deg, #fff8e6 0%, #fff3d1 100%);
}

.arrow {
  color: #999;
  font-size: 18px;
  font-weight: bold;
}

.correct-word {
  color: #27ae60;
  font-weight: bold;
  padding: 6px 12px;
  background: linear-gradient(135deg, #e8f8f0 0%, #d4f3e3 100%);
  border-radius: 6px;
  font-size: 16px;
  box-shadow: 0 2px 4px rgba(39, 174, 96, 0.1);
}

.error-context {
  font-size: 13px;
  color: #555;
  margin-top: 10px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, 'Courier New', monospace;
  background: #f8f9fa;
  padding: 10px 14px;
  border-radius: 6px;
  border-left: 4px solid #4a90e2;
  line-height: 1.5;
}

.highlight-error {
  background-color: #ffeeba !important;
  color: #856404 !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  font-weight: bold !important;
  margin: 0 2px !important;
  border: 1px solid #f5c6cb !important;
  box-shadow: 0 1px 3px rgba(255, 238, 186, 0.5) !important;
}

.copy-btn {
  float: right;
  background: #f0f0f0;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: #666;
  transition: all 0.2s;
}

.copy-btn:hover {
  background: #e0e0e0;
  color: #333;
}

.copy-btn:active {
  transform: scale(0.95);
}

/* 复制成功提示 */
.copy-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  background: #27ae60;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  opacity: 0;
  transition: opacity 0.3s;
}

.copy-toast.show {
  opacity: 1;
}

/* 滚动条样式 */
.text-content::-webkit-scrollbar,
.error-scroll-container::-webkit-scrollbar {
  width: 8px;
}

.text-content::-webkit-scrollbar-track,
.error-scroll-container::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.text-content::-webkit-scrollbar-thumb,
.error-scroll-container::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
  transition: background 0.3s;
}

.text-content::-webkit-scrollbar-thumb:hover,
.error-scroll-container::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .app-container {
    padding: 15px;
  }

  .title {
    font-size: 24px;
  }

  .upload-section {
    padding: 20px;
  }

  .check-btn, .manual-btn, .reset-btn {
    min-width: 100%;
    padding: 14px 20px;
  }

  .panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .panel-actions {
    align-self: flex-end;
  }

  .error-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .selection-buttons {
    flex-direction: column;
  }

  .selection-btn {
    width: 100%;
    justify-content: center;
  }

  .file-name {
    max-width: 200px;
  }
}

.rate-input-container {
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  height: 46px; /* Match button height approx */
  box-sizing: border-box;
  box-shadow: 0 2px 6px rgba(0,0,0,0.05);
}

.rate-label {
  font-size: 14px;
  color: #666;
  font-weight: 500;
  white-space: nowrap;
}

.rate-input {
  width: 60px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.3s;
}

.rate-input:focus {
  border-color: #4a90e2;
}

.search-container {
  display: flex;
  align-items: center;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  height: 46px;
  box-sizing: border-box;
  box-shadow: 0 2px 6px rgba(0,0,0,0.05);
  padding: 0 8px;
  gap: 8px;
}

.search-input {
  border: none;
  outline: none;
  font-size: 14px;
  width: 120px;
  color: #333;
}

.search-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  border-left: 1px solid #eee;
  padding-left: 8px;
}

.search-count {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  min-width: 40px;
  text-align: center;
}

.search-nav-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.search-nav-btn:hover:not(:disabled) {
  background: #f0f0f0;
}

.search-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.search-match {
  background-color: #fff176; /* Yellow highlight for all matches */
  color: #000;
}

.search-current {
  background-color: #ffb74d; /* Orange highlight for current match */
  color: #000;
  font-weight: bold;
  box-shadow: 0 0 0 2px #e65100; /* Border for visibility */
  z-index: 5;
}
</style>