# 通过 DSH 插件市场检测和点击更新

## 为什么显示“本地开发”

DSH Market 1.73.19 根据**已保存的安装来源**判断，不是根据作者的GitHub主页判断：

- `link:D:/...`、`file:...`、解压ZIP后安装本地目录：本地开发，不检查GitHub更新。
- `github:AfreedomF/dice-tour-china#完整40位提交SHA`：GitHub在线来源，可比较仓库最新版本并点击更新。

`@local/dice-tour-china`是现有包名，并不会单独导致本地开发；无需改名而丢失已有配置。

## 现有用户只需迁移一次

先结束正在进行的游戏。保存的身份/房主快照在当前浏览器，不要清除浏览器站点数据。卸载再安装会断开网络。

把以下完整文字发给DSH助手：

> 请将骰游中国从本地开发安装迁移为GitHub可更新安装。先使用plugin_manager列出已有安装及精确包名和source。读取 https://api.github.com/repos/AfreedomF/dice-tour-china/commits/main 获取最新完整40位commit SHA，然后使用安装来源 github:AfreedomF/dice-tour-china#该完整SHA。若当前包为 @local/dice-tour-china 且已安装，先使用plugin_manager移除它再按该GitHub来源安装；不要下载ZIP解压后用本地路径安装，不要写profile配置文件，不要授权依赖构建脚本。失败时明确报告并协助恢复。完成后刷新DSH，并核实source不是link:或file:。

请勿把“下载到某个目录，然后安装目录”当成GitHub安装，否则仍会显示本地开发。仓库根目录已包含构建产物，无需朋友编译。

## 之后如何收到更新

在支持该能力的DSH Market中打开插件市场/已安装列表，会检查在线来源，较新版本显示更新提示，用户点击更新，完成后按提示刷新或重启。可使用市场的手动“检查更新”强制刷新缓存；网络失败、加速路由失败或被忽略/免更新的插件可能不出现提示。

这不是GitHub向所有用户实时推送，也不保证市场关闭时后台定时检查。市场缓存TTL约30分钟并不等于每30分钟主动检查。我们不会绕过市场替用户静默更新、自动覆盖本地开发代码或在游戏中自行执行包管理器。

作者每次发布同时更新根目录和plugin目录package.json的semver，构建并提交plugin/client.js及静态浏览器产物，再发布Release。只发布ZIP或只改GitHub提交而不增加版本，浮动Git安装可能不会出现“新版本”。

## 插件市场目录与安装来源不同

GitHub仓库公开，不等于已被第三方精选市场收录。正确GitHub来源的已安装插件可以使用市场Git更新检测；要让新用户在公共市场搜索到，还需要向awesome-dsh-plugin目录提交条目并由维护者审核，作者不能保证审核时间或自动批准。

不同DSH版本“Plugins→Installed”原生页和“Plugin Market→Installed”不是完全相同更新链路。当前原生管理器对Git更新要求完整commit pin，故上述迁移使用完整SHA；仅#main/标签/未固定来源在某些原生页面没有更新按钮。若原生页不提供目录版本候选，使用DSH Market已安装列表检查更新。

朋友电脑上的实际source、DSH/市场版本及网络只能在朋友那边核实，作者仓库无法远程改写其已安装来源。首次迁移后，后续不再需要每版重新下载ZIP。
