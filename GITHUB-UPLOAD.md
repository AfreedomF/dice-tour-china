# 第一次上传 GitHub（账号 AfreedomF）

本仓库尚需上传后才可通过GitHub来源安装；不要把以下预定地址误认为已发布。

## 网页操作（不需要命令行）

1. 登录 https://github.com ，确认右上角是 AfreedomF。
2. 打开 https://github.com/new 。Repository name 填 `dice-tour-china`，选择 Public，其他初始化选项先不勾选，点击 Create repository。
3. 在新仓库页面点击 uploading an existing file（上传现有文件），或 Add file → Upload files。
4. 完整解压助手提供的 github-upload-source.zip。把解压目录里的文件和文件夹拖进上传区域，**不要把外层文件夹整体当作唯一目录**；上传后仓库根目录应直接看到 package.json、README.md 和 plugin 文件夹。
5. 在页面底部 Commit changes 中填写 `Publish dice tour China 0.1.1`，点击提交，等待上传完成。
6. 仓库链接应为 https://github.com/AfreedomF/dice-tour-china 。打开确认能看到源码。

GitHub网页单次上传最多100个文件，本项目准备的包小于该限制；不包含依赖缓存或本地游戏存档。如果网页限制隐藏文件，可以先上传其余内容，再通过 Add file → Create new file 创建 .gitignore，内容见源码包。

## 给朋友安装

把仓库链接发给朋友，并附这一句：

> 在 DSH 对话里请助手：请从 github:AfreedomF/dice-tour-china 安装骰游中国插件，使用 plugin_manager，先检查是否已安装。

仓库根目录是DSH bundle，包含现成的plugin/client.js，无需朋友自行构建。

## 给没有DSH的朋友下载

可以进入仓库 dist/browser 完整下载；更方便的做法是在仓库右侧 Releases → Create a new release，新建tag `v0.1.1`，标题 `骰游中国 0.1.1`，附上浏览器客户端ZIP及插件ZIP，再点击 Publish release。朋友只需要下载浏览器ZIP并完整解压。

此步骤没有自动部署GitHub Pages，也不需要购买服务器。若希望直接给浏览器网址，之后可以另行开启免费的静态Pages托管（须你授权）。

## 更新

以后只更新源码与重新构建后的插件/浏览器文件，不要上传tools/node_modules、.pnpm-store、账号Token、浏览器身份私钥或房主存档。公开仓库不等于已授予第三方开源再分发许可；需要选MIT等许可证时再由作者决定。
