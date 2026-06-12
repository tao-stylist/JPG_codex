'use strict'

const db = uniCloud.database()
const QWEN_IMAGE_EDIT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const QWEN_IMAGE_MODEL = 'qwen-image-2.0-pro-2026-04-22'

function getDashScopeApiKey() {
  // API Key 只从云函数环境变量读取，避免把密钥写入代码仓库。
  return process.env.DASHSCOPE_API_KEY || ''
}

function createLocalTaskId() {
  // 生成业务侧任务 ID，便于前端查询和数据库建立唯一索引。
  return 'repair_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

async function getPublicImageUrl(fileID) {
  // AI 服务需要公网可访问图片地址；uniCloud fileID 先换成临时访问 URL。
  if (!fileID) return ''
  if (fileID.startsWith('http://') || fileID.startsWith('https://')) return fileID

  const res = await uniCloud.getTempFileURL({
    fileList: [fileID]
  })
  const file = res.fileList && res.fileList.length > 0 ? res.fileList[0] : null
  return file && file.tempFileURL ? file.tempFileURL : ''
}

function getQwenImageUrl(responseData) {
  // 兼容千问多模态返回结构，从 choices.message.content 中提取第一张结果图。
  const output = responseData.output || {}
  const choices = output.choices || []
  for (let i = 0; i < choices.length; i++) {
    const message = choices[i].message || {}
    const content = message.content || []
    for (let j = 0; j < content.length; j++) {
      if (content[j].image) return content[j].image
      if (content[j].url) return content[j].url
    }
  }
  return ''
}

async function createQwenImageEdit(apiKey, imageUrl) {
  // 直接调用 DashScope 多模态生成接口，提示词要求尽量只做自然修复。
  const response = await uniCloud.httpclient.request(QWEN_IMAGE_EDIT_URL, {
    method: 'POST',
    dataType: 'json',
    contentType: 'json',
    timeout: 120000,
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    data: {
      model: QWEN_IMAGE_MODEL,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                image: imageUrl
              },
              {
                text: '请对图片进行自然的图像修复，去除图片中的文字水印、明显瑕疵，并保持主体、构图、文字、颜色和背景纹理尽可能不变。不要添加新的水印、文字或装饰元素。'
              }
            ]
          }
        ]
      }
    }
  })

  return response.data || {}
}

exports.main = async (event) => {
  // 云函数入口：校验入参、获取公网图、调用 AI、落库并返回结果。
  const now = Date.now()
  const taskId = createLocalTaskId()
  const apiKey = getDashScopeApiKey()
  const sourceFileID = event.sourceFileID || ''
  const sourcePreview = event.sourcePreview || ''
  const mask = event.mask || null

  if (!sourceFileID) {
    return {
      code: 'INVALID_IMAGE',
      message: '缺少原图文件'
    }
  }

  if (!apiKey) {
    return {
      code: 'MISSING_API_KEY',
      message: '缺少 DASHSCOPE_API_KEY，请在云函数环境变量中配置阿里云百炼 API Key。'
    }
  }

  let imageUrl = ''
  try {
    // 失败时不直接抛出，后续统一返回 INVALID_IMAGE_URL 给前端展示。
    imageUrl = await getPublicImageUrl(sourceFileID)
  } catch (error) {
    console.log('get temp url failed', error)
  }

  if (!imageUrl) {
    return {
      code: 'INVALID_IMAGE_URL',
      message: '无法获取原图公网访问地址，请确认图片已上传到 uniCloud 云存储。'
    }
  }

  let qwenResult = null
  try {
    qwenResult = await createQwenImageEdit(apiKey, imageUrl)
  } catch (error) {
    console.log('qwen image edit failed', error)
    return {
      code: 'AI_REQUEST_FAILED',
      message: '调用千问图像编辑失败，请检查 API Key、模型权限、免费额度和网络配置。'
    }
  }

  if (qwenResult.code) {
    return {
      code: qwenResult.code,
      message: qwenResult.message || '千问图像编辑调用失败',
      raw: qwenResult
    }
  }

  const resultImageUrl = getQwenImageUrl(qwenResult)
  if (!resultImageUrl) {
    return {
      code: 'INVALID_AI_RESPONSE',
      message: '千问图像编辑未返回结果图片地址',
      raw: qwenResult
    }
  }

  const task = {
    // 当前模型调用是同步返回结果图，因此 providerTaskId 为空、状态直接标记 success。
    taskId,
    provider: 'dashscope-qwen-image',
    providerTaskId: '',
    requestId: qwenResult.request_id || '',
    sourceFileID,
    sourcePreview,
    sourceImageUrl: imageUrl,
    mask,
    mode: event.mode || 'watermark-repair',
    model: QWEN_IMAGE_MODEL,
    status: 'success',
    resultImageUrl,
    mock: false,
    errorMessage: '',
    createdAt: now,
    updatedAt: now
  }

  try {
    await db.collection('repair_tasks').add(task)
  } catch (error) {
    console.log('save task failed', error)
  }

  return {
    code: 0,
    taskId,
    provider: task.provider,
    model: QWEN_IMAGE_MODEL,
    status: task.status,
    resultImageUrl,
    mock: false
  }
}
