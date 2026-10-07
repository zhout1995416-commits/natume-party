# natume-party

natume.party 个人网站：一个《我的世界》风格的方块小世界。小河边有茅草屋和一棵枣树，四周群山环绕。

纯静态页面，部署在 Cloudflare Workers（静态资源）。推送到 `main` 后 Cloudflare 会自动部署，没有构建步骤。

## 能玩什么

- 拖动旋转、滚轮或双指缩放视角（手机和电脑都能用）
- 四季切换：春天开枣花，夏天青枣，秋天红枣和满山红叶，冬天积雪、河面结冰
- 天气：晴 / 雨（冬天变成雪）
- 昼夜：默认跟随现实时间，也可以拖时间条；夜里屋里亮灯、有星星和萤火虫
- 点枣树会摇一摇、掉枣子，点地上的枣子能捡起来计数（存在浏览器本地）
- 点屋门进屋，看个人介绍卡片
- 右上角打开环境声音：流水、雨声、虫鸣、鸟叫，全部实时合成，默认静音

## 网址参数（调试用）

`?season=spring|summer|autumn|winter&weather=sunny|rain&hour=0-24&rotate=0`

## 文件

- `public/index.html`、`public/style.css`：页面和界面
- `public/js/world.js`：地形生成、房屋与树、方块网格（面剔除 + 环境光遮蔽）、季节配色
- `public/js/main.js`：场景、光照与昼夜、天气、交互、动画循环
- `public/js/audio.js`：WebAudio 环境声音
- `public/vendor/`：three.js 0.186.1（MIT，见 `three-LICENSE.txt`），已压缩
- `wrangler.jsonc`：Cloudflare 部署配置
