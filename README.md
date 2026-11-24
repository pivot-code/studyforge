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

### 1. 环境准备

运行 StudyForge 前，需要安装以下环境：

- **Node.js 20.9 或更高版本**（建议使用 LTS 版本）：[官方下载](https://nodejs.org/en/download)
- npm（随 Node.js 一同安装）
- DeepSeek API Key：[DeepSeek 开放平台](https://platform.deepseek.com/)

安装 Node.js 后，重新打开终端，检查版本：

```bash
node -v
npm -v
```

### 2. 获取项目并安装依赖

下载本仓库的 ZIP 压缩包并解压，或使用 Git 克隆仓库。

在终端进入包含 `package.json` 的项目根目录，运行：

```bash
npm install
```

Windows PowerShell 如果提示禁止运行 `npm.ps1`，可改用：

```powershell
npm.cmd install
```

### 3. 配置 DeepSeek API

在项目根目录中，将 `.env.example` 复制并重命名为 `.env.local`。

Windows PowerShell 可以执行：

```powershell
Copy-Item .env.example .env.local
```

打开 `.env.local`，将示例值替换为自己的 DeepSeek API Key：

```env
DEEPSEEK_API_KEY=你的DeepSeek_API_Key
```

### 4. 启动项目

```bash
npm run dev
```

Windows PowerShell 可使用：

```powershell
npm.cmd run dev
```

启动成功后，在浏览器访问：

http://localhost:3000

进入 StudyForge 后，可上传学习资料或选择知识库文档，描述学习需求并创建互动学习空间。

## 技术栈

- **Next.js / React / TypeScript**：应用界面与服务端接口
- **DeepSeek API**：学习规划和 AI 内容生成
- **PDF.js / Mammoth**：学习资料解析
- **浏览器本地存储**：会话、知识库和学习记录

## 使用提示

学习资料、学习空间及学习记录保存在当前浏览器中，更换浏览器或设备后不会自动同步。​
单份 PDF 的解析上限为 100 页。对于超过此限制的文件，请先拆分后再导入。
