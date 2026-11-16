/**
 * Kotlin → TS map
 * ──────────────
 * - `res/values/splash_quotes.xml` — `<string-array name="splash_quotes">`,
 *   100 `<item>` entries, byte-identical copy below (order preserved).
 * - `ui/SplashScreen.kt` (305 lines, the only consumer):
 *     L52-54  `context.resources.getStringArray(R.array.splash_quotes)`
 *              → `SPLASH_QUOTES` (fallback for an empty array = `SPLASH_QUOTES_FALLBACK`,
 *              SplashScreen.kt L54)
 *     L56     `remember(splashQuotes) { splashQuotes.random() }` → `randomSplashQuote()`
 *     L62     `remember { (0..2).random() }`                  → `randomPosterStyle()`
 *
 * RANDOMNESS CONTRACT (SplashScreen.kt L56 / L62)
 * ─────────────────────────────────────────────────
 * `randomQuote` and `defaultPosterStyle` are both inside `remember {}`, i.e. they are
 * sampled **once per entry into the splash screen**, not once per recomposition and not
 * once per frame. Every React caller therefore must sample in a `useState` lazy
 * initialiser (`useState(() => …)`) — never in the render body, which would resample on
 * every re-render and make the quote visibly flicker during the 400 ms fade-in.
 *
 * SEPARATOR CONTRACT (verified char-by-char against the XML)
 * ──────────────────────────────────────────────────────────
 * Each entry is ONE `Text` node (SplashScreen.kt L192-197) — the quote and its source are
 * **not** two lines and there is no `\n` inside any entry. The separator between the
 * quote body and the source is exactly:
 *   U+0020 SPACE, U+2014 EM DASH, U+2014 EM DASH, U+300A LEFT DOUBLE ANGLE BRACKET
 * i.e. ` ——《` — one ASCII space, not an ideographic space. Source attribution always
 * closes with U+300B (`》`). Both are pinned by `tests/unit/splashQuotes.test.ts`.
 *
 * Purity: `src/core/**` must not import React / DOM / Capacitor (ESLint
 * `no-restricted-imports`), so this module is plain data + pure functions. The RNG is
 * **injected** (`random: () => number`) so tests can pin it and so no caller is tempted
 * to call `Math.random()` from a render body.
 */

/**
 * `R.array.splash_quotes` — 100 entries, verbatim from
 * `res/values/splash_quotes.xml`, source order preserved (order is irrelevant to
 * `random()` but is asserted by the test so a re-sort cannot slip in).
 *
 * Frozen so a caller cannot mutate the shared array (Android's resource array is
 * effectively immutable too).
 */
export const SPLASH_QUOTES: readonly string[] = Object.freeze([
  '如果不战斗，就无法获胜！ ——《进击的巨人》',
  '什么都无法舍弃的人，什么也改变不了。 ——《进击的巨人》',
  '人类的赞歌是勇气的赞歌，人类的伟大是勇气的伟大！ ——《JOJO的奇妙冒险》',
  '所谓的觉悟，不是抱定必死之心，而是在黑暗的荒野中，劈出一条理当前进的道路！ ——《JOJO的奇妙冒险》',
  '教练，我想打篮球。 ——《灌篮高手》',
  '要是放弃的话，比赛就到此结束了哦。 ——《灌篮高手》',
  '与其漂亮地牺牲，倒不如漂亮地活到最后一刻。 ——《银魂》',
  '人的梦想，是不会终结的！ ——《海贼王》',
  '人究竟什么时候会死？是被世人遗忘的时候。 ——《海贼王》',
  '错的不是我，是这个世界。 ——《叛逆的鲁路修》',
  '知道雪为什么是白色的吗？因为它忘记了自己曾经的颜色。 ——《叛逆的鲁路修》',
  '虚伪的眼泪会伤害别人，虚伪的笑容会伤害自己。 ——《叛逆的鲁路修》',
  '不伴随痛楚的教训就没有意义，因为人若无牺牲，就无法得到任何东西。 ——《钢之炼金术师》',
  '世界上没有什么偶然，有的只有必然。 ——《xxxHOLiC》',
  '所谓的长大成人，就是不断聚散离合，为了让彼此不会受伤害而保持一个适当的距离。 ——《新世纪福音战士》',
  '不能逃避，不能逃避，不能逃避！ ——《新世纪福音战士》',
  '只要活着，不管走到哪里，哪里都会是天堂。 ——《新世纪福音战士》',
  '温柔正确的人总是难以生存，因为这世界既不温柔，也不正确。 ——《我的青春恋爱物语果然有问题》',
  '青春是一场谎言，一种罪恶。 ——《我的青春恋爱物语果然有问题》',
  '这世上所有的不公平，都是因为当事人能力的不足。 ——《东京喰种》',
  '我不知道什么是真正的正确，但我知道什么是绝对的错误。 ——《东京喰种》',
  '如果有人说怀抱希望是种错误，我一定会反驳这种说法是错的。 ——《魔法少女小圆》',
  '奇迹与魔法，都是存在的。 ——《魔法少女小圆》',
  '我想成为一个温柔的人，因为曾被温柔的人那样对待。 ——《夏目友人帐》',
  '只要有想见的人，就不再是孤单一人了。 ——《夏目友人帐》',
  '能哭的地方，只有厕所，和爸爸的怀里。 ——《CLANNAD》',
  '不管前方的路有多苦，只要走的方向正确，都比站在原地更接近幸福。 ——《千与千寻》',
  '哪怕前路永夜，即便如此我也要前进，因为星光即使微弱也会为我照亮前途。 ——《四月是你的谎言》',
  '即使忘记了你的名字，我也一定会把你找出来。 ——《你的名字。》',
  '被你发现了。 ——《未闻花名》',
  '如果手上没有剑，我就无法保护你；如果一直握着剑，我就无法拥抱你。 ——《死神》',
  '樱花飘落的速度是每秒五厘米，我该用什么样的速度，才能与你相遇？ ——《秒速五厘米》',
  '人生就是一列开往坟墓的列车，路途上会有很多站，很难有人可以至始至终陪着走完。 ——《千与千寻》',
  '我的钻头，可是突破天际的钻头啊！ ——《天元突破红莲螺岩》',
  '不要停下来啊！ ——《机动战士高达 铁血的奥尔芬斯》',
  '我不做人了，JOJO！ ——《JOJO的奇妙冒险》',
  '这一切都是命运石之门的选择！ ——《命运石之门》',
  'El Psy Congroo。 ——《命运石之门》',
  '末将于禁，愿为曹家世代赴汤蹈火！ ——《镇魂街》',
  '只要有树叶飞舞的地方，火就会燃烧。 ——《火影忍者》',
  '我决定了要成为海贼王便要为此而战，就算死也不要紧。 ——《海贼王》',
  '真正重要的东西，总是没有的人比拥有的人清楚。 ——《银魂》',
  '既然已经决定了，那就不要再迷茫了。 ——《全职猎人》',
  '如果我是那雨滴的话，那么，我能够像把不曾交会的天空与大地连接起来那样，把某人的心串联起来吗？ ——《死神》',
  '正因为生命有限，所以才显得更重要；正因为生命有限，所以才更应该努力不懈。 ——《名侦探柯南》',
  '我在未来等你。 ——《穿越时空的少女》',
  '你驻足于春色中，于那独一无二的春色之中。 ——《四月是你的谎言》',
  '一个人是无法知晓自己究竟身在何处的，除非身边有其他人。 ——《新世纪福音战士》',
  '法律不能保护人，是人在保护法律。 ——《心理测量者》',
  '只要是活着的东西，即使是神也杀给你看！ ——《空之境界》',
  '不去抱怨，因为这是我自己的选择。 ——《刀剑神域》',
  '想要拯救谁，就意味着无法拯救其他人。 ——《Fate/Zero》',
  '因为我喜欢你，比这个世界上的任何一个人都要喜欢。 ——《名侦探柯南》',
  '只要你一直前行，就会有路。 ——《机动战士高达 铁血的奥尔芬斯》',
  '我不仅要拯救她，还要拯救这个世界！ ——《天气之子》',
  '爱，才是最扭曲的诅咒。 ——《咒术回战》',
  '没关系，因为我是最强的。 ——《咒术回战》',
  '只要我还能站着，就不会让任何人倒下！ ——《鬼灭之刃》',
  '老去或是死亡，都是人类这种短暂生物的美丽之处。 ——《鬼灭之刃》',
  '如果前方没有路，那我就自己劈出一条！ ——《天元突破红莲螺岩》',
  '只有能在深渊中笑出来的人，才能真正到达顶峰。 ——《来自深渊》',
  '生命总是伴随着失去，但我们必须不断前行。 ——《葬送的芙莉莲》',
  '你要好好的，活下去。 ——《赛博朋克：边缘行者》',
  '我所期待的，只是能与你们一起度过无聊的日常。 ——《凉宫春日的忧郁》',
  '就算我手里一无所有，至少我还能紧紧握住你的手。 ——《罪恶王冠》',
  '世界是很单纯的，复杂的是人。 ——《星际牛仔》',
  '就算全世界都否定你，我也要比他们多一万倍地肯定你！ ——《某科学的超电磁炮》',
  '无论多么痛苦，无论多么悲伤，只要活着，就会有好事发生。 ——《海贼王》',
  '痛苦是生者的特权。 ——《Fate/stay night》',
  '无论过去如何，现在由我来决定。 ——《进击的巨人》',
  '就算梦想破灭，也还有重新筑梦的勇气。 ——《轻音少女》',
  '我们仍未知道那天所看见的花的名字，但我们知道那朵花一直在我们心中绽放。 ——《未闻花名》',
  '所谓的英雄，就是能打破绝境的人啊！ ——《我的英雄学院》',
  '在虚构的故事当中寻求真实感的人脑袋一定有问题。 ——《凉宫春日的忧郁》',
  '与其说是相信，不如说是无法不去相信。 ——《排球少年》',
  '就算跌倒，也要抓一把沙子再站起来！ ——《银魂》',
  '我命由我，不由天！ ——《哪吒之魔童降世》',
  '能够原谅女人谎言的，才是真正的男人。 ——《海贼王》',
  '最纯粹的恶意，往往披着最伪善的外衣。 ——《怪物》',
  '人的心，是比魔法还要强大的力量。 ——《哈尔的移动城堡》',
  '只要我还活着，就一定会让你幸福。 ——《CLANNAD》',
  '你以为我是谁啊！ ——《天元突破红莲螺岩》',
  '真正的觉悟，就是面对自己的命运。 ——《JOJO的奇妙冒险》',
  '人没有牺牲就什么也得不到，为了得到某些东西，就必须付出同等的代价。 ——《钢之炼金术师》',
  '不管你变成什么样子，我都会一直陪在你身边。 ——《紫罗兰永恒花园》',
  '如果你觉得太累了，就停下来休息一下吧。 ——《夏目友人帐》',
  '无论你在哪里，我都会穿越时间去见你。 ——《命运石之门》',
  '没有回忆的人，就等于没有未来。 ——《星际牛仔》',
  '哪怕只有一次，我也想按自己的意志活下去。 ——《薇薇 -萤石眼之歌-》',
  '只要有一丝可能，我就绝不会放弃！ ——《游戏人生》',
  '没有你的世界，就算毁了也无所谓。 ——《未来日记》',
  '既然大家都会死，那为什么还要活着？因为我们还有必须要做的事。 ——《86-不存在的战区-》',
  '没有人可以永远强大，但我们可以永远倔强。 ——《火影忍者》',
  '就算没有超能力，我也想成为英雄。 ——《一拳超人》',
  '把生命燃烧到最后一刻。 ——《鬼灭之刃》',
  '我一定会把你救出来的！ ——《Re:从零开始的异世界生活》',
  '哪怕世界对你充满恶意，我也绝对会保护你。 ——《盾之勇者成名录》',
  '正因为痛苦，人才会成长。 ——《火影忍者》',
  '我不想后悔，所以我选择战斗。 ——《咒术回战》',
  '如果这份感情能被称为爱，那这一定是世界上最悲伤的爱。 ——《紫罗兰永恒花园》',
]);

/**
 * SplashScreen.kt L54 — the value used when `getStringArray` returns an empty array.
 * Byte-identical to `SPLASH_QUOTES[0]` in the shipped resource; kept separate because
 * Kotlin spells it out as its own `arrayOf(...)` literal.
 */
export const SPLASH_QUOTES_FALLBACK = '如果不战斗，就无法获胜！ ——《进击的巨人》';

/**
 * SplashScreen.kt L56 — `splashQuotes.random()`, returning the fallback for an empty
 * array exactly like the `if (array.isNotEmpty())` guard on L54.
 *
 * @param random injected RNG (Kotlin `kotlin.random.Random`); defaults to `Math.random`
 *   only so the module stays convenient outside React. React callers must pass
 *   `Math.random` from a `useState` lazy initialiser, never from the render body.
 */
export function randomSplashQuote(random: () => number = Math.random): string {
  if (SPLASH_QUOTES.length === 0) return SPLASH_QUOTES_FALLBACK;
  const index = Math.floor(random() * SPLASH_QUOTES.length);
  // A generator returning exactly 1.0 would index out of range; clamp like Kotlin's
  // Random.nextInt(size) does.
  const safe = index >= SPLASH_QUOTES.length ? SPLASH_QUOTES.length - 1 : index;
  return SPLASH_QUOTES[safe] as string;
}

/**
 * SplashScreen.kt L62 — `(0..2).random()`, i.e. the `styleIndex` branch selector of
 * `ProceduralArtisticPoster` (SplashScreen.kt L249-253).
 */
export function randomPosterStyle(random: () => number = Math.random): number {
  const raw = Math.floor(random() * 3);
  return raw >= 3 ? 2 : raw;
}
