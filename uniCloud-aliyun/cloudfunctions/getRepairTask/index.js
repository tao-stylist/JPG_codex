'use strict'

const db = uniCloud.database()
const DASHSCOPE_TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks/'

function getDashScopeApiKey() {
  // 查询异步任务时复用云函数环境变量中的 DashScope API Key。
  return process.env.DASHSCOPE_API_KEY || ''
}

function mapDashScopeStatus(status) {
  // 将 DashScope 状态映射为前端统一识别的任务状态。
  if (status === 'PENDING') return 'pending'
  if (status === 'RUNNING') return 'processing'
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') return 'failed'
  return 'processing'
}

async function queryDashScopeTask(apiKey, providerTaskId) {
  // 部分模型会返回异步任务 ID，此函数用于向 DashScope 查询最新进度。
  const response = await uniCloud.httpclient.request(DASHSCOPE_TASK_URL + providerTaskId, {
    method: 'GET',
    dataType: 'json',
    timeout: 60000,
    headers: {
      Authorization: 'Bearer ' + apiKey
    }
  })
  return response.data || {}
}

function getFirstResultUrl(output) {
  // 成功结果通常在 output.results 数组中，这里取第一张可用图片。
  const results = output.results || []
  for (let i = 0; i < results.length; i++) {
    if (results[i].url) return results[i].url
  }
  return ''
}

exports.main = async (event) => {
  // 云函数入口：优先返回本地数据库状态，必要时再同步云端异步任务状态。
  const taskId = event.taskId || ''
  const apiKey = getDashScopeApiKey()

  if (!taskId) {
    return {
      code: 'INVALID_TASK',
      message: '缺少任务ID',
      status: 'failed'
    }
  }

  let task = null
  try {
    const res = await db.collection('repair_tasks').where({ taskId }).limit(1).get()
    if (res.data.length == 0) {
      return {
        code: 'NOT_FOUND',
        message: '任务不存在',
        status: 'failed'
      }
    }
    task = res.data[0]
  } catch (error) {
    console.log('query task failed', error)
    return {
      code: 'QUERY_FAILED',
      message: '查询任务失败',
      status: 'failed'
    }
  }

  if (task.status === 'success' || task.status === 'failed' || !task.providerTaskId) {
    // 已完成、已失败或同步任务无需再请求 DashScope，直接返回数据库记录。
    return {
      code: 0,
      taskId: task.taskId,
      status: task.status,
      sourceImageUrl: task.sourceFileID,
      resultImageUrl: task.resultImageUrl || '',
      errorMessage: task.errorMessage || '',
      mock: task.mock === true
    }
  }

  if (!apiKey) {
    return {
      code: 'MISSING_API_KEY',
      message: '缺少 DASHSCOPE_API_KEY，请在云函数环境变量中配置阿里云百炼 API Key。',
      status: task.status
    }
  }

  let dashscopeResult = null
  try {
    dashscopeResult = await queryDashScopeTask(apiKey, task.providerTaskId)
  } catch (error) {
    console.log('dashscope query failed', error)
    return {
      code: 'AI_QUERY_FAILED',
      message: '查询阿里云百炼任务失败',
      status: task.status
    }
  }

  if (dashscopeResult.code) {
    return {
      code: dashscopeResult.code,
      message: dashscopeResult.message || '阿里云百炼查询任务失败',
      status: task.status,
      raw: dashscopeResult
    }
  }

  const output = dashscopeResult.output || {}
  const providerStatus = output.task_status || 'RUNNING'
  const status = mapDashScopeStatus(providerStatus)
  const resultImageUrl = status === 'success' ? getFirstResultUrl(output) : ''
  const errorMessage = status === 'failed' ? (output.message || output.code || 'AI 任务失败') : ''

  try {
    // 将查询到的最新状态写回数据库，下一次前端查询可以直接命中。
    await db.collection('repair_tasks').doc(task._id).update({
      status,
      resultImageUrl,
      errorMessage,
      updatedAt: Date.now()
    })
  } catch (error) {
    console.log('update task failed', error)
  }

  return {
    code: 0,
    taskId: task.taskId,
    providerTaskId: task.providerTaskId,
    status,
    sourceImageUrl: task.sourceFileID,
    resultImageUrl,
    errorMessage,
    mock: false
  }
}
