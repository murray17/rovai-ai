import type { CampWorldMapNodeId } from './camp-world-map-model'

export type CampWorldMapAmbientTopic =
  | 'wayfinding'
  | 'trace'
  | 'light'
  | 'time'
  | 'sound'
  | 'document'
  | 'object'
  | 'weather'
  | 'water'

export type CampWorldMapAmbientEnvironment = 'any' | 'indoor' | 'outdoor'
export type CampWorldMapAmbientMotion = 'stationary' | 'moving'

type CampWorldMapAmbientBase = {
  id: string
  topic: CampWorldMapAmbientTopic
  text: string
}

export type CampWorldMapNodeSoloBeat = CampWorldMapAmbientBase & {
  kind: 'solo'
  scope: 'node'
  node: CampWorldMapNodeId
  motion: 'stationary'
}

export type CampWorldMapGenericStationarySoloBeat = CampWorldMapAmbientBase & {
  kind: 'solo'
  scope: 'generic'
  environment: CampWorldMapAmbientEnvironment
  motion: 'stationary'
}

export type CampWorldMapMovingSoloBeat = CampWorldMapAmbientBase & {
  kind: 'solo'
  scope: 'generic'
  environment: 'any'
  motion: 'moving'
}

export type CampWorldMapNodeEncounterBeat = CampWorldMapAmbientBase & {
  kind: 'encounter'
  scope: 'node'
  node: CampWorldMapNodeId
  motion: 'stationary'
}

export type CampWorldMapGenericEncounterBeat = CampWorldMapAmbientBase & {
  kind: 'encounter'
  scope: 'generic'
  environment: CampWorldMapAmbientEnvironment
  motion: 'stationary'
}

export type CampWorldMapAmbientBeat =
  | CampWorldMapNodeSoloBeat
  | CampWorldMapGenericStationarySoloBeat
  | CampWorldMapMovingSoloBeat
  | CampWorldMapNodeEncounterBeat
  | CampWorldMapGenericEncounterBeat

export const CAMP_WORLD_MAP_NODE_ENVIRONMENT: Readonly<
  Record<CampWorldMapNodeId, Exclude<CampWorldMapAmbientEnvironment, 'any'>>
> = {
  research: 'outdoor',
  explore: 'outdoor',
  remote: 'outdoor',
  review: 'indoor',
  camp: 'indoor',
  approval: 'outdoor',
  build: 'indoor',
  a2a: 'outdoor',
  memory: 'indoor',
  harbor: 'outdoor',
}

/**
 * Hand-authored ambient copy. Keep each sentence intact; never rebuild it from word slots.
 * Solo beats are neutral toward Member identity. Encounter beats render in one shared bubble.
 */
export const CAMP_WORLD_MAP_AMBIENT_BEATS = [
  // research
  {
    id: 'research-01',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '树根旁露出半块旧路标，箭头被苔藓盖住了一半。'
  },
  {
    id: 'research-02',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '落叶下藏着一段石阶，向林子深处延伸了三步。'
  },
  {
    id: 'research-03',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '风穿过树冠时，远处传来一声很轻的木响。'
  },
  {
    id: 'research-04',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '一串浅浅的脚印绕开主路，在灌木边突然消失。'
  },
  {
    id: 'research-05',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '低枝上系着一小段旧绳，结扣朝着山口。'
  },
  {
    id: 'research-06',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '阳光移开后，树皮上的刻痕才慢慢显出来。'
  },
  {
    id: 'research-07',
    kind: 'solo',
    topic: 'weather',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '露水沿着摊开的地图边缘，停在一处空白旁。'
  },
  {
    id: 'research-08',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '三块路标都指向前方，最旧的那块却装反了。'
  },
  // explore
  {
    id: 'explore-01',
    kind: 'solo',
    topic: 'weather',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '山风掀起地图一角，只好先用一颗小石子压住。'
  },
  {
    id: 'explore-02',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '路边石堆少了一块，缺口正好朝向山谷。'
  },
  {
    id: 'explore-03',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '回声比原来的脚步多了一下，很快又安静下来。'
  },
  {
    id: 'explore-04',
    kind: 'solo',
    topic: 'light',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '云影越过山脊时，旧路短暂地亮了出来。'
  },
  {
    id: 'explore-05',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '尘土散开后，岩面上露出一枚褪色的方向记号。'
  },
  {
    id: 'explore-06',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '两条山路在远处交叠，走近后却隔着一道石缝。'
  },
  {
    id: 'explore-07',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '石缝里夹着一小段蓝线，风停后仍朝着山口。'
  },
  {
    id: 'explore-08',
    kind: 'solo',
    topic: 'time',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '悬在路口的小铃没有响，影子却轻轻晃了一次。'
  },
  // remote
  {
    id: 'remote-01',
    kind: 'solo',
    topic: 'time',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '远处一盏灯比刚才早亮了几秒。'
  },
  {
    id: 'remote-02',
    kind: 'solo',
    topic: 'weather',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '观测镜边缘留着一道雾环，正好圈住港口方向。'
  },
  {
    id: 'remote-03',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '地图空白处多出一条很淡的轮廓，还没有标注名字。'
  },
  {
    id: 'remote-04',
    kind: 'solo',
    topic: 'time',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '台上的两只钟相差半格，却都走得很稳。'
  },
  {
    id: 'remote-05',
    kind: 'solo',
    topic: 'light',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '观测窗里的反光指向另一座没有亮灯的塔。'
  },
  {
    id: 'remote-06',
    kind: 'solo',
    topic: 'weather',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '风向标停了一瞬，随后越过了原来的刻度。'
  },
  {
    id: 'remote-07',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '信号杆轻响两次，第二次比第一次更近。'
  },
  {
    id: 'remote-08',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '一面信号旗叠在最下面，编号却排在最前。'
  },
  // review
  {
    id: 'review-01',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '两张通行单看起来一样，折痕却朝着不同方向。'
  },
  {
    id: 'review-02',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '一处模糊标记被圈了起来，旁边只写着“待确认”。'
  },
  {
    id: 'review-03',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '印章落得很正，边缘却多出了一层浅浅的重影。'
  },
  {
    id: 'review-04',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '比例尺最后一格比其他格短了一点。'
  },
  {
    id: 'review-05',
    kind: 'solo',
    topic: 'time',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '塔钟还没到整点，先轻轻响了一声。'
  },
  {
    id: 'review-06',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '一本合上的册子里露出半截书签，页码没有写全。'
  },
  {
    id: 'review-07',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '封蜡上叠着两枚相近的印记，方向正好相反。'
  },
  {
    id: 'review-08',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '登记页从十七跳到十九，缺掉的一页没有撕痕。'
  },
  // camp
  {
    id: 'camp-01',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '公告板上空出一小格，刚好够放一张新便签。'
  },
  {
    id: 'camp-02',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '快要掉下来的便签被旧针孔勉强挂住。'
  },
  {
    id: 'camp-03',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '一把椅子比其他几把稍微靠后，地上没有拖痕。'
  },
  {
    id: 'camp-04',
    kind: 'solo',
    topic: 'weather',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '杯口的热气绕过桌灯，停在一张空白纸上方。'
  },
  {
    id: 'camp-05',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '桌面留着半道粉笔线，像是画到一半就停了。'
  },
  {
    id: 'camp-06',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '门边的小铃轻响一下，却没有人从门口经过。'
  },
  {
    id: 'camp-07',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '失物架上多了一只手套，另一只不在附近。'
  },
  {
    id: 'camp-08',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '公告板最旧的那张纸，在灯下显出另一层字迹。'
  },
  // approval
  {
    id: 'approval-01',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '门外的脚印走到石阶前就停住了。'
  },
  {
    id: 'approval-02',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '访客牌被风吹歪，过了一会儿又自己转正。'
  },
  {
    id: 'approval-03',
    kind: 'solo',
    topic: 'light',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '门轴上的反光沿着刻度移动，却没有听见开门声。'
  },
  {
    id: 'approval-04',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '钥匙架上两把钥匙几乎一样，标签却互换了位置。'
  },
  {
    id: 'approval-05',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '门槛前的粉笔线中断了一小段，断口很整齐。'
  },
  {
    id: 'approval-06',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '没有风时，悬着的通行牌仍缓慢转了半圈。'
  },
  {
    id: 'approval-07',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '登记簿摊在空白页上，压页石却放在上一页。'
  },
  {
    id: 'approval-08',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '门链中间有一环颜色更浅，尺寸也略小一些。'
  },
  // build
  {
    id: 'build-01',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '冷却架上的金属片轻轻响了一声，像在提醒时间。'
  },
  {
    id: 'build-02',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '散开的零件按大小排好，中间却刚好多出一个空位。'
  },
  {
    id: 'build-03',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '游标卡尺停在半开的刻度上，旁边没有测量对象。'
  },
  {
    id: 'build-04',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '台面画着一块零件的轮廓，架子上却找不到对应形状。'
  },
  {
    id: 'build-05',
    kind: 'solo',
    topic: 'light',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '炉火熄下去后，墙上还留着一小块跳动的亮斑。'
  },
  {
    id: 'build-06',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '冷却架最后一格挂着标签，编号栏却是空的。'
  },
  {
    id: 'build-07',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '一枚小螺丝滚过桌面，正好停在粉笔画的圆心。'
  },
  {
    id: 'build-08',
    kind: 'solo',
    topic: 'light',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '工具的影子排得很整齐，实物却错开了半格。'
  },
  // a2a
  {
    id: 'a2a-01',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '水面漂来一片写着半个字的纸叶。'
  },
  {
    id: 'a2a-02',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '桥下的倒影被水纹划开，过一会儿又合在一起。'
  },
  {
    id: 'a2a-03',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '一只没有名字的纸船卡在岸边石缝里。'
  },
  {
    id: 'a2a-04',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '湿石上留着一圈浅色印记，水位还没有涨到那里。'
  },
  {
    id: 'a2a-05',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '两张长椅都沾着水，靠里的那张却没有雨痕。'
  },
  {
    id: 'a2a-06',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '一片落叶绕着同一块石头转了三圈才继续向下游。'
  },
  {
    id: 'a2a-07',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '桥栏下方多了一枚粉笔记号，刚好贴着水线。'
  },
  {
    id: 'a2a-08',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '桥底传来一声轻响，比水面上的波纹晚了一拍。'
  },
  // memory
  {
    id: 'memory-01',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '一张索引卡从抽屉里滑出来，背面没有编号。'
  },
  {
    id: 'memory-02',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '翻开的书页被压平后，才看见页码中间少了一张。'
  },
  {
    id: 'memory-03',
    kind: 'solo',
    topic: 'time',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '同一本书连续三次停在同一页。'
  },
  {
    id: 'memory-04',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '一只空抽屉总是关不上，里面却什么也没有。'
  },
  {
    id: 'memory-05',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '两张目录卡写着同一个标题，指向的书架却不同。'
  },
  {
    id: 'memory-06',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '旧书里夹着一张船票，日期栏已经褪色。'
  },
  {
    id: 'memory-07',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '书架上的灰尘缺了一块长方形，大小像一本薄册子。'
  },
  {
    id: 'memory-08',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '一枚旧印章放在新标签旁，字体完全相同。'
  },
  // harbor
  {
    id: 'harbor-01',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '潮水退下去，码头边露出一段没画在地图上的石阶。'
  },
  {
    id: 'harbor-02',
    kind: 'solo',
    topic: 'time',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '航班牌翻完一轮，刚才那一格没有再出现。'
  },
  {
    id: 'harbor-03',
    kind: 'solo',
    topic: 'object',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '缆绳上多了一个新结，位置离船还有半步。'
  },
  {
    id: 'harbor-04',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '石墙上的旧潮痕比今天的水位高出许多。'
  },
  {
    id: 'harbor-05',
    kind: 'solo',
    topic: 'trace',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '货箱侧面的粉笔记号被改过两次，最后一层最淡。'
  },
  {
    id: 'harbor-06',
    kind: 'solo',
    topic: 'sound',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '港口钟声从东边传来，回声却落在西侧。'
  },
  {
    id: 'harbor-07',
    kind: 'solo',
    topic: 'water',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '一盏没有点亮的路灯，在水面上留下了倒影。'
  },
  {
    id: 'harbor-08',
    kind: 'solo',
    topic: 'document',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '海鸟丢下一小块木牌，上面只剩半个港口编号。'
  },
  // generic solo
  {
    id: 'generic-any-01',
    kind: 'solo',
    topic: 'light',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '附近一盏灯闪了一下，很快又恢复正常。'
  },
  {
    id: 'generic-any-02',
    kind: 'solo',
    topic: 'sound',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '远处传来两声敲击，间隔刚好一样。'
  },
  {
    id: 'generic-any-03',
    kind: 'solo',
    topic: 'time',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '路边的时钟慢了半格，暂时没有人去拨正。'
  },
  {
    id: 'generic-any-04',
    kind: 'solo',
    topic: 'document',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '一张没有署名的便签夹在两张旧告示之间。'
  },
  {
    id: 'generic-any-05',
    kind: 'solo',
    topic: 'trace',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '阴影移开后，地上的圆形印记才露出来。'
  },
  {
    id: 'generic-any-06',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '两条路线在地图上交叉，现实里却隔着一道墙。'
  },
  {
    id: 'generic-outdoor-01',
    kind: 'solo',
    topic: 'object',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '一片叶子落在地图正中，暂时没有把它移开。'
  },
  {
    id: 'generic-outdoor-02',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '一只小鸟落在路标上，刚好挡住目的地。'
  },
  {
    id: 'generic-outdoor-03',
    kind: 'solo',
    topic: 'weather',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '一阵风带来很淡的木香，很快又散了。'
  },
  {
    id: 'generic-outdoor-04',
    kind: 'solo',
    topic: 'light',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '云影经过时，整条道路像暂时换了一种颜色。'
  },
  {
    id: 'generic-outdoor-05',
    kind: 'solo',
    topic: 'water',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '路边的小水洼映出了一座地图上没有的塔。'
  },
  {
    id: 'generic-outdoor-06',
    kind: 'solo',
    topic: 'trace',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '薄尘里有一串很浅的印记，只在背光处看得见。'
  },
  {
    id: 'generic-indoor-01',
    kind: 'solo',
    topic: 'document',
    scope: 'generic',
    environment: 'indoor',
    motion: 'stationary',
    text: '窗边那叠纸自己翻过了一页。'
  },
  {
    id: 'generic-indoor-02',
    kind: 'solo',
    topic: 'time',
    scope: 'generic',
    environment: 'indoor',
    motion: 'stationary',
    text: '角落里的钟停了一会儿，又重新走了起来。'
  },
  {
    id: 'generic-indoor-03',
    kind: 'solo',
    topic: 'object',
    scope: 'generic',
    environment: 'indoor',
    motion: 'stationary',
    text: '一只空抽屉关不上，里面却什么也没有。'
  },
  {
    id: 'generic-indoor-04',
    kind: 'solo',
    topic: 'document',
    scope: 'generic',
    environment: 'indoor',
    motion: 'stationary',
    text: '灯影移动后，墙上多出一行原本看不清的小字。'
  },
  {
    id: 'generic-indoor-05',
    kind: 'solo',
    topic: 'trace',
    scope: 'generic',
    environment: 'indoor',
    motion: 'stationary',
    text: '桌面留着一个圆形水印，正好压住某条路线。'
  },
  {
    id: 'generic-indoor-06',
    kind: 'solo',
    topic: 'document',
    scope: 'generic',
    environment: 'indoor',
    motion: 'stationary',
    text: '柜门上的两枚标签贴反了，内容却都说得通。'
  },
  {
    id: 'generic-moving-01',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'any',
    motion: 'moving',
    text: '沿路经过三个相同的路牌，第四个终于指向别处。'
  },
  {
    id: 'generic-moving-02',
    kind: 'solo',
    topic: 'light',
    scope: 'generic',
    environment: 'any',
    motion: 'moving',
    text: '走到一半时，身后的灯比前方先亮了起来。'
  },
  {
    id: 'generic-moving-03',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'any',
    motion: 'moving',
    text: '路面上的箭头到转角处忽然中断了。'
  },
  {
    id: 'generic-moving-04',
    kind: 'solo',
    topic: 'object',
    scope: 'generic',
    environment: 'any',
    motion: 'moving',
    text: '一张纸片跟了半条路，最后停在岔口。'
  },
  {
    id: 'generic-moving-05',
    kind: 'solo',
    topic: 'sound',
    scope: 'generic',
    environment: 'any',
    motion: 'moving',
    text: '脚步声在身后多回了一次，拐弯后便消失了。'
  },
  {
    id: 'generic-moving-06',
    kind: 'solo',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'any',
    motion: 'moving',
    text: '道路先窄到只能单行，几步后又恢复原样。'
  },
  // encounter
  {
    id: 'encounter-generic-01',
    kind: 'encounter',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '两位队员同时靠近那块歪掉的路牌，又同时停了下来。'
  },
  {
    id: 'encounter-generic-02',
    kind: 'encounter',
    topic: 'wayfinding',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '两人把地图转了半圈，发现原来的方向反而最清楚。'
  },
  {
    id: 'encounter-generic-03',
    kind: 'encounter',
    topic: 'trace',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '两人对着同一处脚印看了一会儿，最后谁也没有踩上去。'
  },
  {
    id: 'encounter-generic-04',
    kind: 'encounter',
    topic: 'document',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '风吹走一张便签，两人从相反方向追了过去。'
  },
  {
    id: 'encounter-generic-05',
    kind: 'encounter',
    topic: 'time',
    scope: 'generic',
    environment: 'any',
    motion: 'stationary',
    text: '钟声响起时，两人同时抬头，又同时看了眼时间。'
  },
  {
    id: 'encounter-generic-06',
    kind: 'encounter',
    topic: 'light',
    scope: 'generic',
    environment: 'outdoor',
    motion: 'stationary',
    text: '两人各自数了一遍路灯，得到的数字并不一样。'
  },
  {
    id: 'encounter-research-01',
    kind: 'encounter',
    topic: 'wayfinding',
    scope: 'node',
    node: 'research',
    motion: 'stationary',
    text: '两人拨开同一片灌木，下面露出一块反扣的旧路标。'
  },
  {
    id: 'encounter-explore-01',
    kind: 'encounter',
    topic: 'weather',
    scope: 'node',
    node: 'explore',
    motion: 'stationary',
    text: '山风从两侧卷来，两人各按住了地图的一角。'
  },
  {
    id: 'encounter-remote-01',
    kind: 'encounter',
    topic: 'light',
    scope: 'node',
    node: 'remote',
    motion: 'stationary',
    text: '两人轮流看向远处，确认那盏灯确实多闪了一次。'
  },
  {
    id: 'encounter-review-01',
    kind: 'encounter',
    topic: 'document',
    scope: 'node',
    node: 'review',
    motion: 'stationary',
    text: '两人从纸页两端读到中间，同时停在同一个标记旁。'
  },
  {
    id: 'encounter-camp-01',
    kind: 'encounter',
    topic: 'document',
    scope: 'node',
    node: 'camp',
    motion: 'stationary',
    text: '两人同时伸手去扶那张便签，纸面因此转了半圈。'
  },
  {
    id: 'encounter-approval-01',
    kind: 'encounter',
    topic: 'trace',
    scope: 'node',
    node: 'approval',
    motion: 'stationary',
    text: '两人分别检查门的两侧，最后都停在同一道新划痕前。'
  },
  {
    id: 'encounter-build-01',
    kind: 'encounter',
    topic: 'object',
    scope: 'node',
    node: 'build',
    motion: 'stationary',
    text: '两人把多出来的零件放在桌子中间，暂时没有移动它。'
  },
  {
    id: 'encounter-a2a-01',
    kind: 'encounter',
    topic: 'water',
    scope: 'node',
    node: 'a2a',
    motion: 'stationary',
    text: '两人看着同一只纸船漂远，谁也没有先追上去。'
  },
  {
    id: 'encounter-memory-01',
    kind: 'encounter',
    topic: 'document',
    scope: 'node',
    node: 'memory',
    motion: 'stationary',
    text: '两人同时抽中同一张索引卡，卡片背面却是空白的。'
  },
  {
    id: 'encounter-harbor-01',
    kind: 'encounter',
    topic: 'light',
    scope: 'node',
    node: 'harbor',
    motion: 'stationary',
    text: '两人分别数过远处的船灯，最后报出了不同的数字。'
  },
] as const satisfies readonly CampWorldMapAmbientBeat[]
