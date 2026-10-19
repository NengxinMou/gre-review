(function (root, factory) {
  const questions = factory();
  if (typeof module === "object" && module.exports) module.exports = questions;
  else root.GRE_QUESTIONS = questions;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  // {{1}}, {{2}} identify blanks; answers refer to stable option IDs, not display order.
  return [
    {
      id: "verbal-001", number: 1, type: "text-completion", title: "Popular novels", source: "用户截图 · 第 1 题",
      stem: "Some academic criticism of popular novels has been {{1}} in character, being based on the assumption that the wider the appeal, the more {{2}} the novel.",
      groups: [
        { label: "Blank (i)", pick: 1, options: [
          { id: "A", text: "rigorous", meaning: "严谨的；严格的" },
          { id: "B", text: "exculpatory", meaning: "开脱罪责的；证明无罪的" },
          { id: "C", text: "elitist", meaning: "精英主义的；自认为优于大众的" }
        ], answers: ["C"] },
        { label: "Blank (ii)", pick: 1, options: [
          { id: "D", text: "undesirable", meaning: "不受欢迎的；不理想的" },
          { id: "E", text: "accomplished", meaning: "成就卓著的；技艺高超的" },
          { id: "F", text: "comprehensible", meaning: "容易理解的" }
        ], answers: ["D"] }
      ],
      translation: "一些针对通俗小说的学术批评带有精英主义色彩，因为它们基于这样一种假设：小说越受大众欢迎，就越不可取。",
      explanation: "being based on 后面的假设解释了批评的性质：把大众喜爱当成小说不好的依据，体现的是 elitist（精英主义）立场。因此第二空填负面评价 undesirable，而不是把“受欢迎”误读成质量更高。",
      clue: "the wider the appeal, the more ...；后半句解释前半句的评价立场。"
    },
    {
      id: "verbal-002", number: 2, type: "sentence-equivalence", title: "Airport subsidies", source: "用户截图 · 第 2 题",
      stem: "The {{1}} of governmental subsidies to obscure airports that are rarely used underscores the political difficulties of cutting funds from even the most unnecessary projects.",
      groups: [{ label: "选择两个答案", pick: 2, options: [
        { id: "A", text: "paucity", meaning: "匮乏；少量" },
        { id: "B", text: "effectiveness", meaning: "有效性；成效" },
        { id: "C", text: "durability", meaning: "持久性；持续存在" },
        { id: "D", text: "persistence", meaning: "持续存在；延续" },
        { id: "E", text: "adequacy", meaning: "充足；足够" },
        { id: "F", text: "dearth", meaning: "缺乏；匮乏" }
      ], answers: ["C", "D"] }],
      translation: "政府对那些鲜为人知、鲜少使用的机场的补贴仍然长期存在，这凸显了即便是最没有必要的项目，其经费在政治上也难以削减。",
      explanation: "难以削减经费，意味着补贴一直存在。durability 与 persistence 在这里都表达“持续存在”，填入后句意相近。paucity 和 dearth 虽然彼此近义，却都表示“少、缺乏”，不能解释经费难以削减。不能仅凭两个选项互为同义词就选。",
      clue: "underscores ... difficulties of cutting funds：削减困难，对应补贴延续。"
    },
    {
      id: "verbal-003", number: 3, type: "text-completion", title: "Tanaka and Williamson", source: "用户截图 · 第 3 题",
      stem: "What they see in Tanaka is the one candidate capable of {{1}} leadership, in stark contrast to Williamson, whose term in office has been marred by {{2}}.",
      groups: [
        { label: "Blank (i)", pick: 1, options: [
          { id: "A", text: "compassionate", meaning: "有同情心的；富有怜悯心的" },
          { id: "B", text: "decisive", meaning: "果断的；决断明确的" },
          { id: "C", text: "nepotistic", meaning: "任人唯亲的" }
        ], answers: ["B"] },
        { label: "Blank (ii)", pick: 1, options: [
          { id: "D", text: "grandstanding", meaning: "哗众取宠；为博取关注而作秀" },
          { id: "E", text: "partisanship", meaning: "党派偏见；偏袒" },
          { id: "F", text: "vacillation", meaning: "犹豫不决；摇摆不定" }
        ], answers: ["F"] }
      ],
      translation: "他们认为田中是唯一能够展现果断领导力的候选人，这与威廉姆森形成鲜明对比，后者的任期因犹豫不决而受到损害。",
      explanation: "in stark contrast to 要求前后形成鲜明反义；marred by 说明后面是负面特征。decisive（果断）与 vacillation（犹豫不决）正好构成这一对照。其他选项无法在两空之间形成同样明确的反义关系。",
      clue: "in stark contrast to：两个人的领导特征相反。"
    },
    {
      id: "verbal-004", number: 4, type: "sentence-equivalence", title: "Fears and hopes", source: "用户截图 · 第 4 题",
      stem: "Looking back on a project that they had approached with both great {{1}} and considerable aspirations, they were amused to recognize that neither the fears nor the hopes had been at all realistic.",
      groups: [{ label: "选择两个答案", pick: 2, options: [
        { id: "A", text: "purpose", meaning: "目的；意图" },
        { id: "B", text: "talent", meaning: "天赋；才能" },
        { id: "C", text: "abilities", meaning: "能力；才干" },
        { id: "D", text: "trepidation", meaning: "忐忑；担忧；恐惧" },
        { id: "E", text: "misgivings", meaning: "疑虑；担忧" },
        { id: "F", text: "ambition", meaning: "抱负；雄心" }
      ], answers: ["D", "E"] }],
      translation: "回顾一个他们当初既满怀担忧又抱有很大期望的项目时，他们觉得有趣的是，当时的恐惧和希望竟然都完全不切实际。",
      explanation: "后半句的 fears 和 hopes 回指前半句的两种心态。aspirations 对应 hopes，空格因此应对应 fears。trepidation 和 misgivings 都能表达担忧。ambition 与 aspirations 接近，却无法对应后面的 fears。",
      clue: "fears ↔ 空格；hopes ↔ aspirations。"
    }
  ];
});
