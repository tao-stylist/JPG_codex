# Public Release Checklist

Before releasing the app to many users:

1. Configure `DASHSCOPE_API_KEY` as a uniCloud environment variable for both cloud functions:
   - `createRepairTask`
   - `getRepairTask`

2. Do not store API keys in project files. The project should not contain `.env`, `local-secret.js`, or any `sk-...` key.

3. Create a uni-ad rewarded video ad placement in DCloud, then put its `adpid` into:
   - `pages/editor/editor.uvue`
   - `REWARDED_VIDEO_ADPID`

4. Build App packages only after the rewarded video ad placement is configured. App builds intentionally block AI repair when `REWARDED_VIDEO_ADPID` is empty.

5. Upload and deploy:
   - `uniCloud-aliyun/cloudfunctions/createRepairTask`
   - `uniCloud-aliyun/cloudfunctions/getRepairTask`
   - `uniCloud-aliyun/database/repair_tasks.schema.json`

6. Regenerate the DashScope API key before public release if an old key was shared in chat, logs, or screenshots.

7. Run one end-to-end App test: select multiple images, watch the rewarded video, process the batch, and save results.