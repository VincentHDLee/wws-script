// ==UserScript==
// @name         Pacific Front 自动排阵与游玩
// @namespace    local.pacific-front
// @version      1.3.0
// @description  使用页面原有预测引擎，自动进行当前行动；支持只读预览和停止。已适配 asia/eu/com 战区与国服 oceanfront.wowsgame.cn。
// @match        https://pacificfront.worldofwarships.asia/*
// @match        https://pacificfront.worldofwarships.eu/*
// @match        https://pacificfront.worldofwarships.com/*
// @match        https://oceanfront.wowsgame.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function (root) {
  'use strict';
  const SCRIPT_VERSION = '1.3.0';
  const VERSION = 'ad60d10b';
  // 适配的战区源站。统一定义，便于新增或排查。
  const ALLOWED_ORIGINS = Object.freeze([
    'https://pacificfront.worldofwarships.asia',
    'https://pacificfront.worldofwarships.eu',
    'https://pacificfront.worldofwarships.com',
    'https://oceanfront.wowsgame.cn'
  ]);
  // WG 各战区路径前缀可能是语言码（en/ru/zh/zh-tw…），国服 oceanfront 可能无前缀。
  const KNOWN_LANGS = Object.freeze(new Set(
    ['en', 'ru', 'ja', 'de', 'fr', 'pl', 'es', 'it', 'pt', 'tr', 'cs', 'ko', 'th', 'vi', 'zh', 'zh-cn', 'zh-tw']));
  function pageLang() {
    const seg = location.pathname.split('/')[1] || '';
    return KNOWN_LANGS.has(seg.toLowerCase()) ? seg : '';
  }
  // 从当前路径安全解析 operationId / keypointId，兼容“有/无语言前缀”两种情况。
  function routeIds() {
    const m = location.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?operations\/(?:([^/]+)\/?)?([^/]+)?/i);
    if (!m) return { operationId: null, keypointId: null };
    return {
      operationId: m[1] ? decodeURIComponent(m[1]) : null,
      keypointId: m[2] ? decodeURIComponent(m[2]) : null
    };
  }
  const defaults = Object.freeze({ minWinRate: 0.80, targetWinRate: 0.90, maxBattles: 30, delayMs: 2000,
    searchRestarts: 6, searchPasses: 3, maxPredictions: 12000, syncPage: true,
    fillAllSlots: true, useModifiers: true, autoBuy: true, purchaseBudget: Infinity,
    minModifierGain: 0.05, maxModifiersPerBattle: 2, returnToMenu: true, strictVersion: false });
  const finished = k => ['cleared', 'missed'].includes(k.status);
  const slots = k => Array.from({ length: 4 }, (_, i) => k.slots?.[String(i)] ?? null);
  const power = c => Object.values(c?.specs ?? {}).reduce((a, b) => a + b, 0);
  const isBoss = e => e?.tags?.some(t => ['common_boss', 'epic_boss'].includes(t));
  const stageDone = s => s.condition?.type === 'defeat_vehicles'
    ? s.condition.total >= s.condition.target : s.isFinished === true;
  const activeStage = op => op.stages?.find(s => s.isActive) ?? (!op.isStarted ? op.stages?.[0] : null);
  function unwrapResponse(data, path) {
    // Live API responses use { timestamp, result }; only the HTML bootstrap has status: "ok".
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(data) || !Object.prototype.hasOwnProperty.call(data, 'result') ||
        !object(data.result) || (typeof data.status === 'string' && data.status !== 'ok')) {
      const shape = object(data) ? Object.keys(data).slice(0, 12).join(', ') :
        data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
      throw Error(`接口响应格式异常 (${path})：顶层字段/类型 [${shape}]，预期包含 result 对象。`);
    }
    if (path === 'state/' && (!object(data.result.status) || typeof data.result.status.state !== 'string'))
      throw Error('接口响应格式异常 (state/)：缺少 result.status.state。');
    return data.result;
  }
  const usedCards = stage => new Set((stage.keypoints ?? []).filter(k => k.status === 'cleared')
    .flatMap(k => slots(k).map(s => s?.ally?.code).filter(Boolean)));

  function effectPayloads(op, kp, threshold) {
    const stages = op.stages;
    const index = stages.findIndex(s => s.keypoints?.some(k => k.id === kp.id));
    return (op.effects ?? []).filter(e => {
      if (!e.payload || e.payload.delta_disabled) return false;
      const sourceIndex = stages.findIndex(s => s.keypoints?.some(k => k.id === e.source));
      if (!e.applyTo?.includes(kp.id) && !(e.isSubsequent && e.source !== kp.id &&
          sourceIndex >= 0 && sourceIndex < index)) return false;
      const mitigable = e.isMitigable && ![5, 6].includes(e.payload.type);
      if (!mitigable && e.source) {
        const source = stages.flatMap(s => s.keypoints ?? []).find(k => k.id === e.source);
        if (source?.status === 'cleared') {
          const ss = Object.values(source.slots ?? {});
          const wins = ss.reduce((n, s) => n + (s.outcome === 'win'
            ? 1 + Number(s.ally?.modifiers?.includes('moral-impact') ?? false) : 0), 0);
          if (ss.length && Math.min(wins / ss.length, 1) >= threshold) return false;
        }
      }
      return true;
    }).map(e => e.payload);
  }

  function availableCards(catalog, inventory, stage, effects) {
    if (!Array.isArray(inventory.cards)) throw Error('库存格式已变化：没有 cards 数组。');
    const used = usedCards(stage);
    const restrictions = effects.filter(e => e.type === 6).map(e => e.restrictions ?? {});
    const byCode = new Map(catalog.map(c => [c.code, c]));
    return inventory.cards.filter(c => c.health > 0 && !used.has(c.code)).map(item => {
      const card = byCode.get(item.code);
      if (!card) throw Error('未知卡牌：' + item.code);
      return { ...card, health: item.health };
    }).filter(c => !restrictions.some(r => r.cards?.includes(c.code) || r.types?.includes(c.type) ||
      r.tier?.includes(c.tier)));
  }

  function makeEffect(engine, p) {
    const restriction = r => r ? engine.newRestriction(r.cards ?? [], r.types ?? [],
      r.tier ?? [], r.modifiers ?? [], false) : engine.newEmptyRestriction();
    const r = restriction(p.apply_restrictions);
    switch (p.type) {
      case 1: return engine.newMultiplyPlayerSpecsEffect(p.specs ?? {}, p.delta_specs ?? {}, r);
      case 2: return engine.newMultiplyPlayerBuffsEffect(p.multiplier, p.delta_multiplier ?? 0, r);
      case 3: return engine.newMultiplyPlayerDebuffsEffect(p.multiplier, p.delta_multiplier ?? 0, r);
      case 4: return engine.newMultiplyEnemyPowerEffect(p.specs ?? {}, p.delta_specs ?? {}, r);
      case 5: return engine.newDisableAllModifiersEffect(false);
      case 6: return engine.newExtraRestrictionsEffect(restriction(p.restrictions), false);
      default: throw Error('尚未支持的战斗条件：' + p.type);
    }
  }

  function predict(engine, settings, kp, cards, effects, modifiers = [[], [], [], []]) {
    const board = engine.newBoard(4);
    slots(kp).forEach((slot, i) => {
      const enemy = slot?.enemy;
      if (enemy) board.Enemy.Slots[i] = engine.newSlot(engine.newCard(enemy.code,
        enemy.type, enemy.tier, enemy.specs ?? {}, enemy.vulns ?? {}, [], engine.newFullHealth()));
      const c = cards[i];
      if (c) {
        const buffs = [];
        for (const b of c.buffs ?? []) {
          const effect = engine.newEffect(0, true);
          effect.Relative = { [b.spec]: b.value };
          buffs.push(engine.newBuff(b.direction, effect));
        }
        for (const b of c.debuffs ?? []) {
          const effect = engine.newEffect(b.vuln, false);
          effect.Relative = { 0: b.value };
          buffs.push(engine.newBuff(b.direction, effect));
        }
        board.Player.Slots[i] = engine.newSlot(engine.newCard(c.code, c.type, c.tier,
          c.specs ?? {}, {}, buffs, engine.newHealth(c.health, 3)), ...(modifiers[i] ?? []));
      }
    });
    if (effects.length) board.Effects = effects.map(p => makeEffect(engine, p));
    const [ok, error, result] = engine.predict(board, settings);
    if (!ok || error || !result) throw Error('页面预测引擎失败：' + String(error ?? '无结果'));
    const rates = Array.from(result.Predictions);
    if (rates.length !== 4 || rates.some(p => !Number.isFinite(p) || p < 0 || p > 100))
      throw Error('预测引擎返回的胜率格式已变化。');
    return rates.map(p => p / 100);
  }

  // 多起点坐标搜索 + 两卡换位；不是全排列，不保证全局最优。
  async function optimize(kp, candidates, predictor, config, checkpoint, yieldUI) {
    const cache = new Map();
    const enemies = slots(kp).map(s => s?.enemy);
    let best = null, bestAny = null;
    const evaluate = cards => {
      const key = cards.map(c => c?.code ?? '-').join('|');
      if (cache.has(key)) return cache.get(key);
      if (cache.size >= config.maxPredictions) return null;
      const rates = predictor(cards);
      const expected = rates.reduce((n, p, i) => n + (enemies[i] && cards[i] ? p : 0), 0);
      const boss = rates.reduce((n, p, i) => n + (isBoss(enemies[i]) && cards[i] ? p : 0), 0);
      const safe = cards.some(Boolean) && cards.every((c, i) => !c || !enemies[i] || rates[i] >= config.minWinRate);
      const score = (config.fillAllSlots ? cards.filter(Boolean).length * 100000 : 0) + expected * 1000 + boss * 3000 - cards.filter(Boolean).length * 2 -
        cards.reduce((n, c) => n + power(c), 0) * 0.001;
      const result = { cards: cards.slice(), rates, expected, score, safe, predictions: 0 };
      cache.set(key, result);
      if (cards.some(Boolean) && (!bestAny || score > bestAny.score)) bestAny = result;
      if (safe && (!best || score > best.score)) best = result;
      return result;
    };
    const pool = [...candidates].sort((a, b) => power(b) - power(a) || a.code.localeCompare(b.code));
    for (let restart = 0; restart < config.searchRestarts; restart++) {
      checkpoint();
      const seed = Array.from({ length: 4 }, (_, i) => restart === 0 || i >= pool.length ? null :
        pool[(i + (restart - 1) * 3) % pool.length]);
      let current = evaluate(seed);
      if (!current) break;
      for (let pass = 0; pass < config.searchPasses; pass++) {
        let changed = false;
        for (let pos = 0; pos < 4; pos++) {
          checkpoint();
          const old = current;
          for (const c of [null, ...pool]) {
            if (c && current.cards.some((x, i) => i !== pos && x?.code === c.code)) continue;
            const trial = current.cards.slice(); trial[pos] = c;
            const result = evaluate(trial);
            if (result && result.score > current.score) current = result;
          }
          changed ||= old !== current;
          await yieldUI();
        }
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
          const trial = current.cards.slice(); [trial[a], trial[b]] = [trial[b], trial[a]];
          const result = evaluate(trial);
          if (result && result.score > current.score) { current = result; changed = true; }
        }
        if (!changed) break;
      }
    }
    if (!best && config.planning) best = bestAny;
    if (best) best.predictions = cache.size;
    return best;
  }

  function modifierCounts(inventory) {
    return new Map((inventory.modifiers ?? []).map(m => [m.id, m.amount ?? 0]));
  }
  function expectedWins(kp, cards, rates) {
    return rates.reduce((n, p, i) => n + (cards[i] && slots(kp)[i]?.enemy ? p : 0), 0);
  }
  function improveModifiers(engine, settings, kp, effects, plan, inventory, config) {
    const core = { ...engine.newSettings(), ...settings.options.defaultCoreSettings };
    const attrs = engine.getModifiers?.() ?? {};
    const stock = modifierCounts(inventory);
    const disabled = effects.some(e => e.type === 5);
    const restricted = new Set(effects.filter(e => e.type === 6).flatMap(e => e.restrictions?.modifiers ?? []));
    const mods = [[], [], [], []];
    let rates = predict(engine, core, kp, plan.cards, effects, mods);
    let expected = expectedWins(kp, plan.cards, rates);
    const limit = disabled ? 0 : Math.min(config.maxModifiersPerBattle, core.MaxModifiersOnHand ?? 2);
    for (let count = 0; count < limit; count++) {
      let best = null;
      for (let slot = 0; slot < 4; slot++) {
        if (!plan.cards[slot]) continue;
        for (const [id, amount] of stock) {
          const type = attrs[id]?.Type;
          if (amount <= 0 || restricted.has(id) || ![1, 2].includes(type) || mods[slot].some(m => attrs[m]?.Type === type)) continue;
          const trial = mods.map(a => a.slice()); trial[slot].push(id);
          let r;
          try { r = predict(engine, core, kp, plan.cards, effects, trial); } catch { continue; }
          const wins = expectedWins(kp, plan.cards, r), gain = wins - expected;
          if (gain >= config.minModifierGain && (!best || gain > best.gain)) best = { id, slot, rates: r, wins, gain };
        }
      }
      if (!best) break;
      mods[best.slot].push(best.id); stock.set(best.id, stock.get(best.id) - 1);
      rates = best.rates; expected = best.wins;
    }
    return { ...plan, modifiers: mods, rates, expected,
      safe: plan.cards.every((c, i) => !c || !slots(kp)[i]?.enemy || rates[i] >= config.minWinRate),
      score: plan.score + (expected - plan.expected) * 1000 };
  }
  function eventPrice(price, inventory, budget) {
    if (!Array.isArray(price) || !price.length || price.some(p => p.type !== 'currency' || p.code !== 'eventum_1' || !Number.isFinite(p.amount) || p.amount <= 0)) return null;
    const cost = price.reduce((n, p) => n + p.amount, 0);
    return cost <= budget && cost <= (inventory.currencies?.eventum_1 ?? 0) ? cost : null;
  }
  function revalidatePlan(engine, settings, op, kp, inventory, stageId, plan, minWinRate, allowLowWinRate = false) {
    const stage = activeStage(op);
    if (op.isFinished || !op.isStarted || !stage || stage.id !== stageId)
      return { reason: '当前行动或阶段已改变' };
    if (stageDone(stage)) return { reason: '当前阶段目标已完成' };
    if (!stage.keypoints.some(k => k.id === kp.id) || !['revealed', 'unrevealed'].includes(kp.status))
      return { reason: '所选节点已不可出战' };
    if (stage.keypoints.some(k => k.status === 'in_processing')) return { reason: '另一场战斗正在结算' };
    const effects = effectPayloads(op, kp, settings.options.appliedEffectsCancelableClearThreshold ?? 1);
    const available = new Map(availableCards(settings.collection.cards, inventory, stage, effects).map(c => [c.code, c]));
    const codes = plan.cards.filter(Boolean).map(c => c.code);
    if (plan.cards.length !== 4 || !codes.length || new Set(codes).size !== codes.length)
      throw Error('待提交阵容不合法。');
    if (codes.some(code => !available.has(code))) return { reason: '已选卡牌的生命值、出战记录或限制发生变化' };
    const cards = plan.cards.map(c => c ? available.get(c.code) : null);
    const core = { ...engine.newSettings(), ...settings.options.defaultCoreSettings };
    const counts = modifierCounts(inventory);
    for (const id of (plan.modifiers ?? []).flat()) {
      if (effects.some(e => e.type === 5 || (e.type === 6 && e.restrictions?.modifiers?.includes(id))))
        return { reason: '已选增益品受当前战斗条件限制' };
      if (!(counts.get(id) > 0)) return { reason: '已选增益品库存不足' };
      counts.set(id, counts.get(id) - 1);
    }
    const rates = predict(engine, core, kp, cards, effects, plan.modifiers);
    if (!allowLowWinRate && cards.some((c, i) => c && slots(kp)[i]?.enemy && rates[i] < minWinRate))
      return { reason: '最新战斗条件下，已选阵容胜率不再达标' };
    const expected = rates.reduce((n, rate, i) => n + (cards[i] && slots(kp)[i]?.enemy ? rate : 0), 0);
    if (!slots(kp).some(s => s?.enemy)) return { reason: '所选节点已无对位敌人' };
    return { plan: { ...plan, cards, rates, expected }, kp, op };
  }

  // Connect to the existing page providers; no extra app instance or remote code is loaded.
  function findPageBridge(doc) {
    const app = doc.getElementById?.('app');
    if (!app) return {};
    const key = Object.keys(app).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
    if (!key) return {};
    const seed = app[key];
    const queue = [seed?.stateNode?.current ?? seed?.current ?? seed];
    const visited = new Set(), bridge = {};
    while (queue.length && visited.size < 20000) {
      const fiber = queue.pop();
      if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);
      const p = fiber.memoizedProps ?? {};
      for (const store of [p.store, p.value?.store])
        if (typeof store?.dispatch === 'function' && typeof store?.getState === 'function') bridge.store = store;
      if (typeof p.router?.navigate === 'function') bridge.router = p.router;
      if (typeof p.client?.invalidateQueries === 'function') bridge.queryClient = p.client;
      if (bridge.store && bridge.router && bridge.queryClient) break;
      queue.push(fiber.child, fiber.sibling);
    }
    return bridge;
  }
  function toPageCard(card) {
    if (!card) return null;
    // Match the site's catalog normalization: base firepower, survivability, maneuverability.
    // Health, neighbors, modifiers and operation effects are applied separately by the page.
    const specs = [0, 1, 2].map(id => card.specs?.[id] ?? 0);
    const power = specs.reduce((total, value) => total + value, 0);
    if (!specs.every(Number.isFinite) || !Number.isFinite(power))
      throw Error(`卡牌 ${card.code} 的基础属性异常，无法显示战斗力。`);
    return { ...card, power };
  }
  function placePageCards(store, operationId, kp, cards, modifiers = [[], [], [], []], attrs = {}) {
    if (!store.getState().battleBoard) throw Error('页面战斗棋盘尚未初始化。');
    const pageCards = cards.map(toPageCard);
    const dispatch = (name, payload) => store.dispatch({ type: 'battleBoard/' + name, payload });
    dispatch('initKeypoint', { operationId, keypointId: kp.id, keypoint: kp });
    dispatch('setBattleAnimationPhase', null);
    const usedEntities = new Set();
    for (const board of Object.values(store.getState().battleBoard.keypoints)) {
      Object.values(board.modifiersEntityId ?? {}).forEach(id => usedEntities.add(id));
      for (const m of [...(board.modifiersGroupA ?? []), ...(board.modifiersGroupB ?? [])]) if (m) usedEntities.add(m.entityId);
    }
    // Same reducers as the site's drag-and-drop, including clearing modifier drafts.
    for (const type of ['inventory_card', 'inventory_modifier_group_a', 'inventory_modifier_group_b']) {
      const group = type === 'inventory_modifier_group_a' ? 1 : 2;
      const placements = pageCards.map((c, i) => {
        if (type === 'inventory_card') return c ? { card: c } : null;
        const id = (modifiers[i] ?? []).find(id => attrs[id]?.Type === group);
        if (!id) return null;
        let index = 0;
        while (usedEntities.has(`${kp.id}:${id}:${index}`)) index++;
        const entityId = `${kp.id}:${id}:${index}`; usedEntities.add(entityId);
        return { modifier: { id, entityId } };
      });
      dispatch('setPreviews', { type, slots: placements });
      dispatch('applyPreviews', { keypointId: kp.id, dropTargetId: null });
    }
    const placed = store.getState().battleBoard.keypoints[kp.id];
    if (!placed || cards.some((c, i) => (placed.cards[i]?.code ?? null) !== (c?.code ?? null)))
      throw Error('页面卡槽没有接受选定阵容。');
    if (pageCards.some((c, i) => c && placed.cards[i]?.power !== c.power))
      throw Error('页面卡槽没有接受卡牌战斗力数据。');
    for (let i = 0; i < 4; i++) for (const [type, name] of [[1, 'modifiersGroupA'], [2, 'modifiersGroupB']]) {
      const wanted = (modifiers[i] ?? []).find(id => attrs[id]?.Type === type) ?? null;
      if ((placed[name]?.[i]?.id ?? null) !== wanted) throw Error('页面增益品槽没有接受选定配置。');
    }
  }

  const internals = { defaults, finished, slots, stageDone, activeStage, usedCards, unwrapResponse,
    revalidatePlan, findPageBridge, toPageCard, placePageCards, improveModifiers, eventPrice,
    effectPayloads, availableCards, makeEffect, predict, optimize };
  if (typeof module === 'object' && module.exports) { module.exports = internals; return; }
  if (!ALLOWED_ORIGINS.includes(location.origin)) return;
  if (root.PacificFrontBot) { console.info('PacificFrontBot 已加载。更新脚本后请刷新游戏网页，以加载新版本。'); return; }

  let running = false, stopped = false, ui = null;
  const logLines = [];
  const config = { ...defaults };
  const log = message => {
    const text = `[${new Date().toLocaleTimeString()}] ${message}`;
    logLines.push(text); if (logLines.length > 100) logLines.shift();
    console.info('[PacificFrontBot]', message);
    if (ui) { ui.textContent = logLines.slice(-15).join('\n'); ui.scrollTop = ui.scrollHeight; }
  };
  const checkpoint = () => { if (stopped) throw Error('已停止；已发出的战斗请求仍可能完成。'); };
  const sleep = async ms => {
    const end = Date.now() + ms;
    while (Date.now() < end) { checkpoint(); await new Promise(r => setTimeout(r, Math.min(200, end - Date.now()))); }
    checkpoint();
  };
  function validate() {
    const pageVersion = (root.settings?.STATIC_URL || '').match(/\/([0-9a-f]{6,})\//)?.[1] || null;
    if (pageVersion && pageVersion !== VERSION) {
      const msg = `当前页面构建版本为 ${pageVersion}，本脚本针对 ${VERSION} 编写。`;
      if (config.strictVersion) throw Error(msg + '（已启用 strictVersion）请核对接口后再运行。');
      log('提示：' + msg + '若预测引擎或接口有变动，行为可能异常。');
    }
    if (!root.adeck?.predict || !root.defaultState?.settings?.collection?.cards)
      throw Error('游戏未加载完毕。请先登录、打开一个行动，等待页面显示后重试。');
    if (!Number.isFinite(config.minWinRate) || config.minWinRate < 0 || config.minWinRate > 1)
      throw Error('minWinRate 必须在 0 到 1 之间。');
    for (const k of ['maxBattles', 'searchRestarts', 'searchPasses', 'maxPredictions', 'maxModifiersPerBattle'])
      if (!Number.isSafeInteger(config[k]) || config[k] < 1) throw Error(`${k} 必须为正整数。`);
    if (!Number.isFinite(config.delayMs) || config.delayMs < 1000) throw Error('delayMs 至少为 1000。');
    if (!(config.purchaseBudget >= 0) || (config.purchaseBudget !== Infinity && !Number.isFinite(config.purchaseBudget))) throw Error('购买预算必须是非负数或 Infinity。');
    if (!Number.isFinite(config.targetWinRate) || config.targetWinRate < config.minWinRate || config.targetWinRate > 1) throw Error('优化目标胜率必须介于开战底线和 100% 之间。');
  }
  async function api(path, body) {
    checkpoint();
    const method = body === undefined ? 'GET' : 'POST';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { Accept: 'application/json' };
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        const token = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('csrftoken='));
        if (token) headers['X-CSRFToken'] = decodeURIComponent(token.slice(10));
      }
      const response = await fetch('/api/v2/' + path, { method, headers, credentials: 'same-origin',
        cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw Error(`HTTP ${response.status} (${path})`);
      let data;
      try { data = await response.json(); }
      catch { throw Error(`接口未返回有效 JSON (${path})，请检查登录状态后刷新页面。`); }
      return unwrapResponse(data, path);
    } catch (error) {
      throw Error(`${error.message}${method === 'POST' ? '；没有重发。请刷新页面核对该操作是否已完成，再继续。' : ''}`);
    } finally { clearTimeout(timer); }
  }
  async function poll(read, accept, label) {
    for (let n = 0; n < 20; n++) {
      await sleep(config.delayMs);
      const value = await read();
      if (accept(value)) return value;
    }
    throw Error(label + '等待超时；已暂停，请刷新页面检查。');
  }
  async function readyInventory() {
    let status = await api('inventory/status/');
    if (status.inPending) await poll(() => api('inventory/status/'), s => !s.inPending, '库存同步');
    const inventory = await api('inventory/');
    if (inventory.unfinishedTransactions) throw Error('库存仍有未结算事务，请稍后重试。');
    return inventory;
  }
  const readOperation = id => api(`operation/${encodeURIComponent(id)}/`);
  const readKeypoint = id => api(`keypoint/${encodeURIComponent(id)}/`);
  async function syncBoard(id, kp, plan, required = false) {
    if (!config.syncPage && !required) return;
    try {
      let bridge = findPageBridge(document);
      const lang = pageLang();
      const path = (lang ? '/' + lang : '') + `/operations/${encodeURIComponent(id)}/${encodeURIComponent(kp.id)}`;
      if (location.pathname.replace(/\/$/, '') !== path) {
        if (!bridge.router) throw Error('未找到页面路由');
        await bridge.router.navigate(path);
      }
      for (let i = 0; i < 40; i++) {
        checkpoint();
        bridge = findPageBridge(document);
        if (bridge.store?.getState().battleBoard?.activeKeypointId === kp.id) break;
        await sleep(200);
      }
      if (!bridge.store || bridge.store.getState().battleBoard?.activeKeypointId !== kp.id)
        throw Error('未找到当前节点的战斗棋盘');
      checkpoint();
      placePageCards(bridge.store, id, kp, plan.cards, plan.modifiers, root.adeck.getModifiers?.() ?? {});
      log('已自动选卡并填入页面卡槽。');
      await sleep(800);
    } catch (error) {
      checkpoint();
      if (required) throw error;
      log(`页面选卡显示同步失败：${error.message}。仍将通过战斗接口提交已验证阵容。`);
    }
  }
  async function refreshPage(id, kp) {
    const bridge = findPageBridge(document);
    if (!bridge.queryClient) return;
    try {
      if (kp) bridge.queryClient.setQueryData?.(['keypoint', kp.id], { timestamp: Date.now() / 1000, result: kp });
      // Invalidation schedules the page's normal read requests and must not block the bot.
      for (const queryKey of [['state'], ['operation', 'detail', id], ['inventory'], ['keypoint']])
        Promise.resolve(bridge.queryClient.invalidateQueries({ queryKey })).catch(() => {});
    } catch (error) { log('页面显示刷新失败，可手动刷新查看结果：' + error.message); }
  }
  async function recheck(id, stageId, choice) {
    checkpoint();
    const op = await readOperation(id);
    const inventory = await readyInventory();
    const kp = await readKeypoint(choice.kp.id);
    checkpoint();
    return revalidatePlan(root.adeck, root.defaultState.settings, op, kp, inventory,
      stageId, choice.plan, config.minWinRate);
  }
  function printPlan(kp, plan) {
    log(`节点 ${kp.name ?? kp.id}：预计击败 ${plan.expected.toFixed(2)} 个敌人，搜索 ${plan.predictions} 个阵容。`);
    log(plan.cards.map((c, i) => `${i + 1}: ${c?.code ?? '空位'}${c ? ` / HP ${c.health} / 胜率 ${(plan.rates[i] * 100).toFixed(1)}%` : ''}`).join('\n'));
    if (plan.modifiers?.flat().length) log('使用增益品：' + plan.modifiers.map((m, i) => m.length ? `${i + 1}号位 ${m.join(' + ')}` : '').filter(Boolean).join('；'));
  }
  async function planKeypoint(op, kp, inventory) {
    const settings = root.defaultState.settings;
    const effects = effectPayloads(op, kp, settings.options.appliedEffectsCancelableClearThreshold ?? 1);
    const candidates = availableCards(settings.collection.cards, inventory, activeStage(op), effects);
    if (!candidates.length) return null;
    const core = { ...root.adeck.newSettings(), ...settings.options.defaultCoreSettings };
    if (core.HandSize !== 4) throw Error('棋盘不再是四个位置。');
    const plan = await optimize(kp, candidates, cards => predict(root.adeck, core, kp, cards, effects),
      { ...config, planning: true }, checkpoint, () => sleep(1));
    return plan && config.useModifiers ? improveModifiers(root.adeck, settings, kp, effects, plan, inventory, config) : plan;
  }
  async function menu(final = false) {
    if (!config.returnToMenu) return;
    checkpoint();
    const lang = pageLang();
    const path = (lang ? '/' + lang : '') + '/operations';
    const bridge = findPageBridge(document);
    if (bridge.router) { await bridge.router.navigate(path); log('已返回行动主菜单。'); }
    else if (final && typeof location.assign === 'function') location.assign(path);
    else log('无法在不中断运行的情况下切换菜单；行动结束时返回。');
  }
  async function purchaseIfUseful(op, choice, inventory, budget) {
    if (!config.autoBuy || budget <= 0) return null;
    const settings = root.defaultState.settings;
    const occupied = choice.plan.cards.filter(Boolean).length;
    const utility = p => p.cards.filter(Boolean).length * 10 + p.expected;
    if (occupied === 4 && choice.plan.rates.every((r, i) => !slots(choice.kp)[i]?.enemy || r >= config.targetWinRate)) return null;
    let best = null;
    const consider = candidate => {
      if (candidate.gain < config.minModifierGain) return;
      if (!best || candidate.gain / Math.max(candidate.cost, 1) > best.gain / Math.max(best.cost, 1)) best = candidate;
    };
    const cardCost = inventory.freeFleetSupportRequests > 0 ? 0 : eventPrice(settings.options.cardBuyPrice, inventory, budget);
    const rewardCards = new Set([...(settings.progressBar?.main ?? []).flatMap(r => r.reward ?? []),
      ...(settings.progressBar?.post?.reward ?? [])].map(r => r.code?.replace(/^adeck2_/, '')));
    const unowned = settings.collection.cards.some(c => !c.tags?.includes('demo') && !rewardCards.has(c.code) && !inventory.cards.some(i => i.code === c.code));
    if (cardCost !== null && unowned) {
      let offers;
      try { offers = await api('card/purchase/'); }
      catch (error) { checkpoint(); log('卡牌商店暂不可用，跳过本次购卡：' + error.message); }
      if (offers?.cardOptions != null && !Array.isArray(offers.cardOptions)) throw Error('卡牌商店响应格式变化，已停止购买。');
      for (const code of offers?.cardOptions ?? []) {
        if (typeof code !== 'string' || inventory.cards.some(c => c.code === code)) continue;
        const plan = await planKeypoint(op, choice.kp, { ...inventory, cards: [...inventory.cards, { code, health: 3 }] });
        if (plan) consider({ type: 'card', id: code, cost: cardCost, gain: utility(plan) - utility(choice.plan) });
      }
    }
    if (config.useModifiers) {
      for (const m of settings.collection.modifiers ?? []) {
        const cost = eventPrice(m.price, inventory, budget);
        if (cost === null) continue;
        const modifiers = (inventory.modifiers ?? []).filter(x => x.id !== m.id);
        const amount = modifierCounts(inventory).get(m.id) ?? 0;
        modifiers.push({ id: m.id, amount: amount + 1 });
        const effects = effectPayloads(op, choice.kp, settings.options.appliedEffectsCancelableClearThreshold ?? 1);
        const base = { ...choice.plan, expected: expectedWins(choice.kp, choice.plan.cards,
          predict(root.adeck, { ...root.adeck.newSettings(), ...settings.options.defaultCoreSettings }, choice.kp, choice.plan.cards, effects)) };
        const plan = improveModifiers(root.adeck, settings, choice.kp, effects, base, { ...inventory, modifiers }, config);
        consider({ type: 'modifier', id: m.id, cost, gain: plan.expected - choice.plan.expected });
      }
    }
    if (!best) return null;
    const fresh = await readyInventory();
    if (best.cost > (fresh.currencies?.eventum_1 ?? 0)) return null;
    if (best.type === 'card' && best.cost === 0 && !(fresh.freeFleetSupportRequests > 0)) return null;
    checkpoint();
    log(`购买${best.type === 'card' ? '卡牌' : '增益品'} ${best.id}，消耗 ${best.cost} 活动货币${best.cost === 0 ? '（使用免费补给次数）' : ''}。`);
    if (best.type === 'card') {
      await api('card/purchase/confirm/', { cardCode: best.id });
      await poll(() => readyInventory(), inv => inv.cards.some(c => c.code === best.id), '购买卡牌到账');
    } else {
      const before = modifierCounts(fresh).get(best.id) ?? 0;
      await api('modifier/purchase/', { modifierId: best.id, amount: 1 });
      await poll(() => readyInventory(), inv => (modifierCounts(inv).get(best.id) ?? 0) > before, '购买增益品到账');
    }
    await refreshPage(op.id);
    return best;
  }
  async function work(mode) {
    const preview = mode === 'preview', fillOnly = mode === 'fill';
    validate();
    const state = await api('state/');
    if (state.status?.state === 'unauth') throw Error('请先登录游戏。');
    const route = routeIds();
    const id = state.status?.operationId ?? route.operationId;
    if (!id) throw Error('请先在网页上选择一个行动，进入行动详情后再启动。');
    if (route.operationId && state.status?.operationId && route.operationId !== state.status.operationId)
      throw Error('页面所选行动与服务器当前行动不同，请打开当前行动再启动。');
    let op = await readOperation(id);
    if (op.isFinished) throw Error('当前行动已结束。请在网页上选择下一个行动。');
    if (!op.isStarted && fillOnly) throw Error('行动尚未开始。请使用“自动游玩”，或先在网页开始行动再选卡。');
    if (!op.isStarted && !preview) {
      log('开始当前行动。');
      await api('operation/start/', { operationId: id });
      op = await poll(() => readOperation(id), o => o.isStarted, '行动开始');
    }
    let battles = 0, replans = 0, spent = 0;
    const budget = config.purchaseBudget;
    if (!preview && !fillOnly) log(`优先填满四槽；自动购买${config.autoBuy ? `已开启，活动货币预算 ${budget === Infinity ? '不限额' : budget}` : '已关闭'}。`);
    async function reschedule(reason) {
      if (++replans >= 3) throw Error(`连续三次复核未通过（${reason}），已暂停。请检查是否还有其他页面在操作。`);
      log(`阵容需要更新：${reason}。重新选卡（${replans}/3）。`);
      await sleep(config.delayMs);
    }
    while (true) {
      checkpoint();
      op = await readOperation(id);
      if (op.isFinished) { log('行动已结束。'); await menu(true); return; }
      const stage = activeStage(op);
      if (!stage) throw Error('没有可识别的当前阶段，请刷新网页检查。');
      if (stage.keypoints.some(k => k.status === 'in_processing')) {
        if (preview) throw Error('有战斗尚在结算，稍后再预览。');
        await poll(() => readOperation(id), o => !activeStage(o)?.keypoints.some(k => k.status === 'in_processing'), '战斗结算');
        continue;
      }
      const next = op.stages[op.stages.indexOf(stage) + 1];
      if (stageDone(stage)) {
        if (preview || fillOnly) { log(next ? '当前阶段目标已完成，自动游玩将进入下一阶段。' : '最终阶段目标已完成，自动游玩将检查并结束行动。'); return; }
        if (next) {
          log('当前阶段目标已完成，进入下一阶段。');
          await api('operation/next-stage/', {});
          await poll(() => readOperation(id), o => activeStage(o)?.id === next.id, '阶段切换');
          await refreshPage(id);
          continue;
        }
        const bosses = stage.keypoints.flatMap(k => slots(k)).filter(s => isBoss(s?.enemy));
        if (bosses.some(s => s.outcome !== 'win')) throw Error('最终阶段主目标尚未击败，已暂停。');
        const fresh = await api('state/');
        if (!fresh.status?.isOperationReadyToComplete) throw Error('服务器尚未允许结束行动，已暂停。');
        log('结束当前行动。');
        await api('operation/complete/', {});
        await poll(() => api('state/'), s => s.status?.operationId !== id, '行动结束');
        await refreshPage(id);
        log('当前行动已完成。请刷新网页查看结算；如需继续，请选择另一个行动。');
        await menu(true);
        return;
      }
      if (battles >= config.maxBattles) { log('已达到本次战斗上限，暂停。'); return; }
      const openedKeypoint = route.keypointId;
      const remaining = stage.keypoints.filter(k => !finished(k) &&
        (!fillOnly || !openedKeypoint || k.id === openedKeypoint));
      if (!remaining.length) throw Error('当前阶段已无可打节点，但目标未达成。请手动检查。');
      const inventory = await readyInventory();
      let choice = null;
      for (const brief of remaining) {
        checkpoint();
        const kp = await readKeypoint(brief.id);
        if (finished(kp) || kp.status === 'in_processing') continue;
        if (!['revealed', 'unrevealed'].includes(kp.status)) throw Error('未知节点状态：' + kp.status);
        log(`计算节点 ${kp.name ?? kp.id} 的阵容…`);
        const plan = await planKeypoint(op, kp, inventory);
        if (plan && plan.cards.some(Boolean) && (!choice || (plan.safe && !choice.plan.safe) ||
          (plan.safe === choice.plan.safe && plan.score > choice.plan.score))) choice = { kp, plan };
      }
      if (!preview && !fillOnly) {
        const purchaseChoice = choice ?? { kp: await readKeypoint(remaining[0].id),
          plan: { cards: [null, null, null, null], rates: [0, 0, 0, 0], expected: 0, score: 0, predictions: 0 } };
        const bought = await purchaseIfUseful(op, purchaseChoice, inventory, budget - spent);
        if (bought) { spent += bought.cost; log(`本次累计购买支出：${spent} 活动货币，重新读取库存并排阵。`); continue; }
      }
      if (!choice) throw Error('没有可出战卡牌或满足当前配置的阵容，且无可购买的有效补给。');
      if (!choice.plan.safe && !preview) throw Error(`可用补给后仍没有达到单槽 ${config.minWinRate * 100}% 底线的阵容，已暂停。`);
      printPlan(choice.kp, choice.plan);
      if (preview) { log('预览结束，没有提交战斗。'); return; }
      // Re-check actual playability instead of comparing entire changing API objects.
      let checked = await recheck(id, stage.id, choice);
      if (checked.reason) { await reschedule(checked.reason); continue; }
      choice = checked;
      await syncBoard(id, choice.kp, choice.plan, fillOnly);
      if (fillOnly) { log('自动选卡完成，尚未开始战斗。点击“自动游玩”可继续自动战斗。'); return; }
      checked = await recheck(id, stage.id, choice);
      if (checked.reason) { await reschedule(checked.reason); continue; }
      choice = checked;
      checkpoint();
      const battleSetup = { slots: choice.plan.cards.map((c, i) => c ? { cardCode: c.code,
        ...((choice.plan.modifiers?.[i]?.length ?? 0) > 0 ? { modifiers: choice.plan.modifiers[i] } : {}) } : null) };
      log(`提交第 ${battles + 1} 场战斗。`);
      await api('keypoint/start/', { keypointId: choice.kp.id, battleSetup });
      const result = await poll(() => readKeypoint(choice.kp.id), finished, '战斗结果');
      await refreshPage(id, result);
      log(`第 ${battles + 1} 场已结算：${slots(result).filter(s => s?.outcome === 'win').length} 个位置获胜。`);
      await sleep(config.delayMs);
      battles++;
      replans = 0;
    }
  }
  async function start(mode) {
    if (running) { log('已有任务运行中。'); return; }
    running = true; stopped = false;
    try {
      if (!navigator.locks) throw Error('浏览器缺少 Web Locks，请使用新版 Edge 或 Chrome。');
      await navigator.locks.request('pacific-front-auto', { ifAvailable: true }, async lock => {
        if (!lock) throw Error('另一个标签页正在运行脚本。');
        log(mode === 'preview' ? '开始只读预览。' : mode === 'fill' ? '开始自动选卡（不提交战斗）。' : '开始自动游玩当前行动。');
        await work(mode);
      });
    } catch (e) { log(e.message); }
    finally { running = false; }
  }
  root.PacificFrontBot = { version: SCRIPT_VERSION, config, preview: () => start('preview'),
    fill: () => start('fill'), run: () => start('run'),
    stop: () => { stopped = true; log('已请求停止，等待当前请求返回。'); },
    get running() { return running; }, get logs() { return logLines.slice(); } };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;top:80px;width:350px;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{color:#e8eff5;font:13px/1.5 system-ui}section{background:#102132;border:1px solid #67849d;border-radius:10px;padding:14px;box-shadow:0 8px 35px #0008}h3{margin:0 0 8px}button{padding:7px 10px;margin:3px;border:0;border-radius:5px;cursor:pointer;background:#dce7ed;color:#102132}pre{font:12px/1.5 system-ui;white-space:pre-wrap;max-height:280px;overflow:auto;margin-bottom:0}.note{color:#b4c6d6;font-size:12px}</style><section><h3>Pacific Front 自动游玩</h3><div class="note">当前行动 · 不使用修改器 · 默认最低单卡胜率 90%</div><button id="preview">仅预览</button><button id="run">开始运行</button><button id="stop">停止</button><button id="hide">收起</button><pre></pre></section>`;
  ui = shadow.querySelector('pre');
  shadow.querySelector('h3').textContent = `Pacific Front 自动游玩 v${SCRIPT_VERSION}`;
  shadow.querySelector('.note').textContent = '单槽开战底线80% · 优先满四槽 · 活动货币购买不限额';
  shadow.querySelector('#preview').onclick = () => start('preview');
  const fillButton = document.createElement('button');
  fillButton.textContent = '自动选卡';
  fillButton.onclick = () => start('fill');
  shadow.querySelector('#run').before(fillButton);
  shadow.querySelector('#run').textContent = '自动游玩';
  shadow.querySelector('#run').onclick = () => start('run');
  shadow.querySelector('#stop').onclick = () => root.PacificFrontBot.stop();
  shadow.querySelector('#hide').onclick = e => { ui.hidden = !ui.hidden; e.target.textContent = ui.hidden ? '展开' : '收起'; };
  document.documentElement.append(host);
  log(`v${SCRIPT_VERSION} 已加载（支持 ${ALLOWED_ORIGINS.length} 个战区）。“自动选卡”只填卡槽；“自动游玩”会选卡并连续战斗。`);
})(typeof window === 'object' ? window : globalThis);
