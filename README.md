# StudyForge

**An AI Agent That Adapts to How You Learn**

StudyForge 是一个由 AI 智能体驱动的个性化学习工作台。你可以上传课件、选择知识库中的资料，再用自然语言描述学习目标或遇到的困难。智能体据此组织学习内容，推荐合适的互动方式，生成可以反复进入的学习空间。

从理解概念到检验掌握程度，学习方式随你的需求调整。

## 功能亮点

- **个性化学习规划**：围绕学习目标与具体困难，生成分阶段的学习建议。
- **知识库与资料引用**：导入 PDF、DOCX、TXT，按需选择本次学习使用的文档。
- **概念理解空间**：分步骤讲解、追问、举例和理解检查。
- **互动知识图谱**：梳理知识点及其关联。
- **练习与闪卡**：生成选择题和闪卡，按主题学习与复习。
- **原题题库**：导入并校对现有题目，创建独立练习空间。
- **学习进度管理**：保留学习空间、答题记录、错题和收藏，方便继续学习。

## 如何使用

1. **提供资料**：上传课程文件，或从知识库选择已有文档。
2. **描述需求**：例如「我不理解根轨迹的绘制规则，想结合课件逐步学习」。
3. **选择学习方式**：查看智能体建议，进入概念理解、知识图谱、练习或闪卡空间。
4. **持续学习**：回到已创建的学习空间，继续学习和复习。

## 本地运行

**准备：** [Node.js](https://nodejs.org/)（含 npm）和一个 [DeepSeek API Key](https://platform.deepseek.com/)。

1. 下载仓库 ZIP 并解压，或使用 Git 克隆仓库。在终端进入项目根目录。
2. 安装依赖：

   ```bash
   npm install
   ```

3. 将根目录中的 `.env.example` 复制为 `.env.local`，填写自己的密钥：

   ```env
   DEEPSEEK_API_KEY=your_deepseek_api_key_here
   ```

   Windows PowerShell 可执行 `Copy-Item .env.example .env.local`。

4. 启动开发服务器：

   ```bash
   npm run dev
   ```

5. 打开 [http://localhost:3000](http://localhost:3000)。

Windows PowerShell 如限制 `npm` 脚本运行，可改用 `npm.cmd install` 和 `npm.cmd run dev`。

## 技术栈

- **Next.js / React / TypeScript**：应用界面与服务端接口
- **DeepSeek API**：学习规划和 AI 内容生成
- **PDF.js / Mammoth**：学习资料解析
- **浏览器本地存储**：会话、知识库和学习记录

## 使用提示

学习资料、学习空间及学习记录保存在当前浏览器中，更换浏览器或设备后不会自动同步。​
单份 PDF 的解析上限为 100 页。对于超过此限制的文件，请先拆分后再导入。
