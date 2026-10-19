// ==UserScript==
// @name         Pacific Front 自动排阵与游玩 (用多不用少与空仓提醒版)
// @namespace    local.pacific-front
// @version      2.3.1
// @description  大洋战线阶段最优规划；30舰全图鉴精准双语、五星高难适配、道具用多不用少、白道具空仓温馨提示手动买15个(禁自动扣款)、空仓裸卡优先、关底全黄卡压上与代币定向加速。
// @match        https://pacificfront.worldofwarships.asia/*
// @match        https://pacificfront.worldofwarships.eu/*
// @match        https://pacificfront.worldofwarships.com/*
// @match        https://oceanfront.wowsgame.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function (root) {
  'use strict';
  const SCRIPT_VERSION = '2.3.1';
  const VERSION = 'ad60d10b';
  const ALLOWED_ORIGINS = Object.freeze([
    'https://pacificfront.worldofwarships.asia',
    'https://pacificfront.worldofwarships.eu',
    'https://pacificfront.worldofwarships.com',
    'https://oceanfront.wowsgame.cn'
  ]);

  function routeInfo(pathname) {
    const match = pathname.match(/^\/(?:(?<lang>[a-z]{2}(?:-[a-z0-9]{2,8})*)\/)?operations(?:\/(?<op>[^/]+)(?:\/(?<kp>[^/]+))?)?\/?$/i);
    if (!match) return { prefix: '', operationId: null, keypointId: null };
    try {
      return {
        prefix: match.groups.lang ? '/' + match.groups.lang : '',
        operationId: match.groups.op ? decodeURIComponent(match.groups.op) : null,
        keypointId: match.groups.kp ? decodeURIComponent(match.groups.kp) : null
      };
    } catch {
      throw Error('页面行动地址的编码无效，请重新打开行动页面。');
    }
  }

  function operationPath(pathname, operationId, keypointId) {
    return routeInfo(pathname).prefix + '/operations' + (operationId ? '/' + encodeURIComponent(operationId) : '') +
      (keypointId ? '/' + encodeURIComponent(keypointId) : '');
  }

  const defaults = Object.freeze({
    minSelectionWinRate: 0.80, minWinRate: 0.90, targetWinRate: 1, maxBattles: 30, delayMs: 1000,
    searchRestarts: 6, searchPasses: 3, maxPredictions: 12000, syncPage: true,
    fillAllSlots: true, useModifiers: true, autoBuy: false, // 严格禁止自动扣款购买
    minModifierGain: 0, maxModifiersPerBattle: Infinity, maxModifierPredictions: 12000,
    modifierBeamWidth: 16, maxJointPredictions: 60000, maxSearchMs: 4000, unlimitedHardSearch: true,
    preferNoModifiers: true, returnToMenu: true,
    fullClearStage: true
  });

  const BILINGUAL_SHIPS = {
    "地狱俯冲者": '“地狱俯冲者”俯冲轰炸机 埃塞克斯 / SB2C Helldiver (Essex)',
    "helldiver": '“地狱俯冲者”俯冲轰炸机 埃塞克斯 / SB2C Helldiver (Essex)',
    "f4u": 'F4U战斗机 埃塞克斯 / F4U Corsair (Essex)',
    "corsair": 'F4U战斗机 埃塞克斯 / F4U Corsair (Essex)',
    "密苏里": '密苏里 / Missouri',
    "missouri": '密苏里 / Missouri',
    "北卡罗来纳": '北卡罗来纳 / North Carolina',
    "north_carolina": '北卡罗来纳 / North Carolina',
    "阿拉斯加": '阿拉斯加 / Alaska',
    "alaska": '阿拉斯加 / Alaska',
    "巴尔的摩": '巴尔的摩 / Baltimore',
    "baltimore": '巴尔的摩 / Baltimore',
    "拉菲": '拉菲 / Laffey',
    "laffey": '拉菲 / Laffey',
    "约翰斯顿": '约翰斯顿 / Johnston',
    "johnston": '约翰斯顿 / Johnston',
    "复仇者": '“复仇者”鱼雷轰炸机 企业 / TBF Avenger (Enterprise)',
    "avenger": '“复仇者”鱼雷轰炸机 企业 / TBF Avenger (Enterprise)',
    "地狱猫": '“地狱猫”战斗机 企业 / F6F Hellcat (Enterprise)',
    "hellcat": '“地狱猫”战斗机 企业 / F6F Hellcat (Enterprise)',
    "英王乔治五世": '英王乔治五世 / King George V',
    "king_george": '英王乔治五世 / King George V',
    "科罗拉多": '科罗拉多 / Colorado',
    "colorado": '科罗拉多 / Colorado',
    "克利夫兰": '克利夫兰 / Cleveland',
    "cleveland": '克利夫兰 / Cleveland',
    "圣地亚哥": '圣地亚哥 / San Diego',
    "san_diego": '圣地亚哥 / San Diego',
    "新奥尔良": '新奥尔良 / New Orleans',
    "new_orleans": '新奥尔良 / New Orleans',
    "基德": '基德 / Kidd',
    "kidd": '基德 / Kidd',
    "本森": '本森 / Benson',
    "benson": '本森 / Benson',
    "凯旋": '凯旋 / Le Triomphant',
    "triomphant": '凯旋 / Le Triomphant',
    "反击": '反击 / Repulse',
    "repulse": '反击 / Repulse',
    "新墨西哥": '新墨西哥 / New Mexico',
    "new_mexico": '新墨西哥 / New Mexico',
    "无畏式": '“无畏式”俯冲轰炸机 萨拉托加 / SBD Dauntless (Saratoga)',
    "dauntless": '“无畏式”俯冲轰炸机 萨拉托加 / SBD Dauntless (Saratoga)',
    "休斯": '休斯 / Hughes',
    "hughes": '休斯 / Hughes',
    "野猫": '“野猫”战斗机 萨拉托加 / F4F Wildcat (Saratoga)',
    "wildcat": '“野猫”战斗机 萨拉托加 / F4F Wildcat (Saratoga)',
    "霍巴特": '霍巴特 / Hobart',
    "hobart": '霍巴特 / Hobart',
    "马布尔黑德": '马布尔黑德 / Marblehead',
    "marblehead": '马布尔黑德 / Marblehead',
    "德·鲁伊特": '德·鲁伊特 / De Ruyter',
    "德.鲁伊特": '德·鲁伊特 / De Ruyter',
    "de_ruyter": '德·鲁伊特 / De Ruyter',
    "法拉格特": '法拉格特 / Farragut',
    "farragut": '法拉格特 / Farragut',
    "箭": '箭 / Arrow',
    "arrow": '箭 / Arrow',
    "约翰·d·福特": '约翰·D·福特 / John D. Ford',
    "约翰.d.福特": '约翰·D·福特 / John D. Ford',
    "ford": '约翰·D·福特 / John D. Ford',
    "吸血鬼": '吸血鬼 / Vampire',
    "vampire": '吸血鬼 / Vampire'
  };

  const BILINGUAL_MODS = {
    repair: '战地维修 / Field Repair',
    specialization: '专业强化 / Specialization',
    rudder: '舵效培训 / Rudder Training',
    token: '效率提升 / Progress Booster',
    effectiveness: '效率提升 / Progress Booster',
    attack: '火力增强 / Firepower Boost',
    defense: '装甲强化 / Armor Reinforcement',
    focused: '专注打击 / Focused Strike'
  };

  function formatCardName(c) {
    if (!c) return '空位 / Empty';
    const realName = String(c.title ?? c.name ?? '').trim();
    const code = String(c.code ?? '').toLowerCase();
    const lowName = realName.toLowerCase();
    for (const [key, val] of Object.entries(BILINGUAL_SHIPS)) {
      if (code.includes(key) || lowName.includes(key) || realName.includes(key)) return val;
    }
    return realName ? `${realName} (${c.code})` : c.code;
  }

  function formatModifierName(id) {
    if (!id) return '';
    const low = String(id).toLowerCase();
    for (const [key, val] of Object.entries(BILINGUAL_MODS)) {
      if (low.includes(key)) return val;
    }
    return id;
  }

  function getCardColor(c) {
    if (!c) return { label: '空位', tierGroup: 'none', weight: 0 };
    const p = power(c);
    if (p >= 170) return { label: '核心黄/Yellow', tierGroup: 'yellow', weight: 300 };
    if (p >= 130) return { label: '中阶蓝/Blue', tierGroup: 'blue', weight: 30 };
    if (p >= 106) return { label: '高级白/Adv White', tierGroup: 'adv_white', weight: 5 };
    return { label: '基础白/Base White', tierGroup: 'base_white', weight: 1 };
  }

  function calcSingleCardCost(c) {
    if (!c) return 0;
    return getCardColor(c).weight * 1000 + power(c);
  }

  const finished = k => ['cleared', 'missed'].includes(k.status);
  const slots = k => Array.from({ length: 4 }, (_, i) => k.slots?.[String(i)] ?? null);
  const power = c => Object.values(c?.specs ?? {}).reduce((a, b) => a + b, 0);

  const isCommonBoss = e => e?.tags?.some(t => t === 'common_boss');
  const isEpicBoss = e => e?.tags?.some(t => t === 'epic_boss');

  function isFinalTokenBossNode(op, kp) {
    const stage = activeStage(op);
    if (!stage) return false;
    const stages = op.stages ?? [];
    const isLastStage = stages.length > 0 && stages[stages.length - 1]?.id === stage.id;
    return isLastStage && slots(kp).some(s => isEpicBoss(s?.enemy) || isCommonBoss(s?.enemy) || String(s?.enemy?.code).includes('boss'));
  }

  function getKeypointThreat(kp) {
    if (Number.isFinite(kp.stars) && kp.stars > 0) return kp.stars * 1000;
    const diff = String(kp.difficulty ?? '').toLowerCase();
    if (diff === 'hard' || diff.includes('困') || diff === '3') return 3000;
    if (diff === 'normal' || diff === 'medium' || diff.includes('中') || diff === '2') return 2000;
    if (diff === 'easy' || diff.includes('简') || diff === '1') return 1000;
    return slots(kp).reduce((sum, s) => sum + (s?.enemy ? power(s.enemy) : 0), 0);
  }

  function parseSlotReward(slot) {
    if (!slot) return { type: 'unknown', amount: 0, label: '无目标', isRepairDrop: false };
    const jsonStr = JSON.stringify(slot).toLowerCase();
    const isRepairDrop = jsonStr.includes('repair') || jsonStr.includes('维修') || jsonStr.includes('wrench');

    const tokenMatch = jsonStr.match(/(?:amount|count|value|total|quantity)["':\s]+(\d{3,5})/);
    if (jsonStr.includes('3960') || jsonStr.includes('3200') || jsonStr.includes('3080') || jsonStr.includes('2800') || isEpicBoss(slot?.enemy) || String(slot?.enemy?.code).includes('boss')) {
      const amt = Number(tokenMatch?.[1] ?? 2800);
      return { type: 'token', amount: amt, label: `👑${amt}代币`, isRepairDrop };
    }
    if (jsonStr.includes('1045') || jsonStr.includes('935') || jsonStr.includes('660') || jsonStr.includes('600')) {
      const amt = Number(tokenMatch?.[1] ?? 600);
      return { type: 'token', amount: amt, label: `👑${amt}代币`, isRepairDrop };
    }
    if (tokenMatch && Number(tokenMatch[1]) >= 100) {
      const amt = Number(tokenMatch[1]);
      return { type: 'token', amount: amt, label: `👑${amt}代币`, isRepairDrop };
    }
    if (jsonStr.includes('eventum') || jsonStr.includes('progress_token')) {
      return { type: 'token', amount: 100, label: '👑进度代币', isRepairDrop };
    }
    if (isRepairDrop) {
      return { type: 'item', amount: 1, label: '🔧修船包奖励', isRepairDrop: true };
    }
    if (jsonStr.includes('modifier') || jsonStr.includes('item') || jsonStr.includes('ticket')) {
      return { type: 'item', amount: 1, label: '⚔️道具奖励', isRepairDrop: false };
    }
    return { type: 'supply', amount: 1, label: '⚓舰队补给', isRepairDrop: false };
  }

  function getSlotTargetRate(slot) {
    const enemy = slot?.enemy;
    if (!enemy) return 0;
    const rewardInfo = parseSlotReward(slot);
    const p = power(enemy);

    const isRed = isEpicBoss(enemy) || enemy.tier >= 4 || p >= 220;
    const isYellow = !isRed && (isCommonBoss(enemy) || enemy.tier === 3 || p >= 150);

    if (rewardInfo.type === 'token') return 1.0;
    if (rewardInfo.isRepairDrop) return 0.95;
    if (isRed) return 1.0;
    if (isYellow) return 0.90;
    if (rewardInfo.type === 'item') return 0.85;
    if (rewardInfo.type === 'supply') return 0.80;

    return 0.80;
  }

  const stageDone = s => s.condition?.type === 'defeat_vehicles'
    ? s.condition.total >= s.condition.target : s.isFinished === true;
  const activeStage = op => op.stages?.find(s => s.isActive) ?? (!op.isStarted ? op.stages?.[0] : null);

  function unwrapResponse(data, path) {
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(data) || !Object.prototype.hasOwnProperty.call(data, 'result') ||
        !object(data.result) || (typeof data.status === 'string' && data.status !== 'ok')) {
      const shape = object(data) ? Object.keys(data).slice(0, 12).join(', ') :
        data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
      throw Error(`接口响应格式异常 (${path})：[${shape}]`);
    }
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

  function availableCards(catalog, inventory, stage, effects, excludedCodes = new Set()) {
    if (!Array.isArray(inventory.cards)) throw Error('库存格式已变化：没有 cards 数组。');
    const used = usedCards(stage);
    const restrictions = effects.filter(e => e.type === 6).map(e => e.restrictions ?? {});
    const byCode = new Map(catalog.map(c => [c.code, c]));
    return inventory.cards.filter(c => c.health > 0 && !used.has(c.code) && !excludedCodes.has(c.code)).map(item => {
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

  function createPredictor(engine, settings, kp, effects) {
    const enemies = slots(kp).map(slot => slot?.enemy ? engine.newCard(slot.enemy.code,
      slot.enemy.type, slot.enemy.tier, slot.enemy.specs ?? {}, slot.enemy.vulns ?? {}, [], engine.newFullHealth()) : null);
    const preparedEffects = effects.map(p => makeEffect(engine, p));
    const cardCache = new WeakMap();
    return (cards, modifiers = [[], [], [], []]) => {
      const board = engine.newBoard(4);
      enemies.forEach((enemy, i) => {
        if (enemy) board.Enemy.Slots[i] = engine.newSlot(enemy);
        const c = cards[i];
        if (c) {
          let prepared = cardCache.get(c);
          if (!prepared) {
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
            prepared = engine.newCard(c.code, c.type, c.tier, c.specs ?? {}, {}, buffs, engine.newHealth(c.health, 3));
            cardCache.set(c, prepared);
          }
          board.Player.Slots[i] = engine.newSlot(prepared, ...(modifiers[i] ?? []));
        }
      });
      if (preparedEffects.length) board.Effects = preparedEffects;
      const [ok, error, result] = engine.predict(board, settings);
      if (!ok || error || !result) throw Error('页面预测引擎失败：' + String(error ?? '无结果'));
      const rates = Array.from(result.Predictions);
      return rates.map(p => p / 100);
    };
  }

  function modifierCounts(inventory) {
    return new Map((inventory.modifiers ?? []).map(m => [m.id, m.amount ?? 0]));
  }
  function expectedWins(kp, cards, rates) {
    return rates.reduce((n, p, i) => n + (cards[i] && slots(kp)[i]?.enemy ? p : 0), 0);
  }

  function planMetricsWithTargets(kp, cards, rates, config) {
    const kpSlots = slots(kp);
    const targetRates = kpSlots.map(s => s?.enemy ? getSlotTargetRate(s) : 0);

    let deficit = 0, covered = 0, totalEnemies = 0;
    let zeroSlotCount = 0;

    kpSlots.forEach((s, i) => {
      if (s?.enemy) {
        totalEnemies++;
        const actualRate = cards[i] ? rates[i] : 0;
        const target = targetRates[i];
        if (actualRate >= target - 1e-4) {
          covered++;
        } else {
          deficit += (target - actualRate);
          if (actualRate < 0.25) zeroSlotCount++;
        }
      }
    });

    const safe = totalEnemies > 0 && deficit <= 1e-4;
    return {
      safe, selectionSafe: safe,
      battleCovered: covered,
      battleDeficit: deficit + zeroSlotCount * 25,
      zeroSlotCount,
      targetRates,
      weakestRate: Math.min(1, ...kpSlots.flatMap((s, i) => s?.enemy ? [cards[i] ? rates[i] : 0] : []))
    };
  }

  function isWhiteModifier(mId, collectionModifiers) {
    const mod = (collectionModifiers ?? []).find(m => m.id === mId);
    return Boolean(mod?.price);
  }

  function isRepairModifier(mId, collectionModifiers) {
    const mod = (collectionModifiers ?? []).find(m => m.id === mId);
    const text = `${mod?.id ?? ''} ${mod?.name ?? ''} ${mod?.description ?? ''} ${(mod?.tags ?? []).join(' ')}`.toLowerCase();
    return text.includes('repair') || text.includes('维修') || text.includes('恢复') || text.includes('heal');
  }

  function findTokenBooster(collectionModifiers) {
    for (const m of collectionModifiers ?? []) {
      const text = `${m.id ?? ''} ${m.name ?? ''} ${m.description ?? ''} ${(m.tags ?? []).join(' ')}`.toLowerCase();
      if ((text.includes('token') || text.includes('progress') || text.includes('代币') || text.includes('进度') || text.includes('effectiveness') || text.includes('效率')) && m.price) {
        return m;
      }
    }
    return (collectionModifiers ?? []).find(m => m.price && String(m.id).toLowerCase().includes('token')) ?? null;
  }

  function comparePlans(a, b, config, context) {
    const { isFinalBoss, maxYMaxAllowed } = context;

    if (a.zeroSlotCount !== b.zeroSlotCount) {
      return a.zeroSlotCount - b.zeroSlotCount;
    }

    if (!isFinalBoss && Number.isFinite(maxYMaxAllowed)) {
      const aYellow = a.cards.filter(c => c && getCardColor(c).tierGroup === 'yellow').length;
      const bYellow = b.cards.filter(c => c && getCardColor(c).tierGroup === 'yellow').length;
      const aOver = aYellow > maxYMaxAllowed;
      const bOver = bYellow > maxYMaxAllowed;
      if (aOver !== bOver) return aOver ? 1 : -1;
    }

    const safeDiff = Number(b.safe) - Number(a.safe);
    if (safeDiff !== 0) return safeDiff;

    if (config.fillAllSlots) {
      const slotDiff = b.cards.filter(Boolean).length - a.cards.filter(Boolean).length;
      if (slotDiff !== 0) return slotDiff;
    }

    if (a.safe && b.safe) {
      if (isFinalBoss) {
        const countGreenMods = plan => (plan.modifiers ?? []).flat().filter(id => !isWhiteModifier(id, context.collectionMods)).length;
        const greenA = countGreenMods(a);
        const greenB = countGreenMods(b);
        if (greenA !== greenB) return greenA - greenB;

        const bId = findTokenBooster(context.collectionMods)?.id;
        const nonTokenA = (a.modifiers ?? []).flat().filter(id => id !== bId).length;
        const nonTokenB = (b.modifiers ?? []).flat().filter(id => id !== bId).length;
        if (nonTokenA !== nonTokenB) return nonTokenA - nonTokenB;

        const totalPowerA = a.cards.reduce((sum, c) => sum + power(c), 0);
        const totalPowerB = b.cards.reduce((sum, c) => sum + power(c), 0);
        if (totalPowerB !== totalPowerA) return totalPowerB - totalPowerA;

        return (b.weakestRate ?? 0) - (a.weakestRate ?? 0);
      }

      // 普通据点：裸卡优先，成本最低优先
      const aMods = a.modifiers?.flat().length ?? 0;
      const bMods = b.modifiers?.flat().length ?? 0;
      if (aMods === 0 && bMods > 0) return -1;
      if (bMods === 0 && aMods > 0) return 1;

      // 【用多不用少】：如果都带了道具，优先使用库存充裕的道具
      if (context.stock) {
        const getStockSum = plan => (plan.modifiers ?? []).flat().reduce((s, id) => s + (context.stock.get(id) ?? 0), 0);
        const stockA = getStockSum(a);
        const stockB = getStockSum(b);
        if (stockA !== stockB) return stockB - stockA;
      }

      const calcCost = plan => {
        let cardCost = plan.cards.reduce((sum, c) => sum + calcSingleCardCost(c), 0);
        let modCost = 0;
        for (const mList of plan.modifiers ?? []) {
          for (const mId of mList) {
            if (isRepairModifier(mId, context.collectionMods)) modCost += 50000;
            else if (isWhiteModifier(mId, context.collectionMods)) modCost += 1000;
            else modCost += 200000;
          }
        }
        return cardCost + modCost;
      };

      const costA = calcCost(a), costB = calcCost(b);
      if (Math.abs(costA - costB) > 0.1) return costA - costB;

      if (aMods !== bMods) return aMods - bMods;

      const rateDiff = (b.weakestRate ?? 0) - (a.weakestRate ?? 0);
      if (Math.abs(rateDiff) > 0.001) return rateDiff;
    }

    const defDiff = a.battleDeficit - b.battleDeficit;
    if (Math.abs(defDiff) > 0.05) return defDiff;

    return b.expected - a.expected || (b.weakestRate ?? 0) - (a.weakestRate ?? 0) || b.score - a.score;
  }

  // --- 智能搜索引擎（道具用多不用少，空仓自然裸卡出战） ---
  async function optimizeJoint(engine, settings, kp, candidates, effects, inventory, config,
      checkpoint, yieldUI, seedPlans = [], rateCache = new Map(), onProgress = () => {}, context = {}) {
    const { isFinalBoss, allowWhiteMods } = context;
    const now = () => typeof performance === 'object' ? performance.now() : Date.now();
    const startedAt = now(), deadline = startedAt + (config.maxSearchMs ?? 4000);
    checkpoint();
    const core = { ...engine.newSettings(), ...settings.options.defaultCoreSettings };
    const attrs = engine.getModifiers?.() ?? {};
    const stock = modifierCounts(inventory);
    context.stock = stock;
    const disabled = !config.useModifiers || effects.some(e => e.type === 5);
    const restricted = new Set(effects.filter(e => e.type === 6).flatMap(e => e.restrictions?.modifiers ?? []));

    const isModAllowedInSearch = id => {
      if (disabled || restricted.has(id)) return false;
      const isWhite = isWhiteModifier(id, settings.collection.modifiers);
      const isRep = isRepairModifier(id, settings.collection.modifiers);

      if (isRep) return false;
      if (isFinalBoss) return !isWhite;
      if (!isWhite) return false;
      return Boolean(allowWhiteMods);
    };

    // 道具按库存降序探索，库存为0的白色道具自然排除（由裸卡优先替代）
    const groups = [1, 2].map(type => [
      null,
      ...[...stock]
        .filter(([id, count]) => count > 0 && isModAllowedInSearch(id) && attrs[id]?.Type === type)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([id]) => id)
    ]);
    const allocations = groups[0].flatMap(a => groups[1].map(b => [a, b].filter(Boolean)));

    const pool = [...candidates].sort((a, b) => {
      if (isFinalBoss) {
        return power(b) - power(a) || a.code.localeCompare(b.code);
      }
      const costA = calcSingleCardCost(a);
      const costB = calcSingleCardCost(b);
      return costA - costB || power(a) - power(b);
    });

    const byCode = new Map(pool.map(c => [c.code, c]));
    const cache = new Map(), lineups = new Set();
    let best = null, predictions = 0, firstError = '';
    const limit = config.maxJointPredictions ?? 60000;
    const preparedPredict = createPredictor(engine, core, kp, effects);
    let cacheHits = 0;
    const emptyMods = () => [[], [], [], []];

    function evaluate(cards, modifiers) {
      const codes = cards.filter(Boolean).map(c => c.code);
      if (!codes.length || new Set(codes).size !== codes.length || codes.some(code => !byCode.has(code))) return null;
      const mods = modifiers.map((m, i) => cards[i] ? [...m].sort() : []);
      const counts = new Map();
      for (const m of mods) {
        const types = new Set();
        for (const id of m) {
          const type = attrs[id]?.Type;
          if (![1, 2].includes(type) || restricted.has(id) || types.has(type)) return null;
          types.add(type); counts.set(id, (counts.get(id) ?? 0) + 1);
          if (counts.get(id) > (stock.get(id) ?? 0)) return null;
        }
      }
      const key = JSON.stringify([cards.map(c => c?.code ?? null), mods]);
      if (cache.has(key)) return cache.get(key);
      if (best && now() >= deadline) return null;
      if (predictions >= limit) return null;
      predictions++;
      let rates;
      try {
        rates = rateCache.get(key);
        if (rates) cacheHits++;
        else {
          rates = preparedPredict(cards, mods);
          if (rateCache.size >= 30000) rateCache.delete(rateCache.keys().next().value);
          rateCache.set(key, rates);
        }
      } catch (error) { firstError ||= error.message; throw error; }

      const expected = expectedWins(kp, cards, rates);
      const metrics = planMetricsWithTargets(kp, cards, rates, config);
      const score = (config.fillAllSlots ? cards.filter(Boolean).length * 100000 : 0) + expected * 1000;
      const plan = {
        cards: cards.slice(), modifiers: mods, rates, expected, score,
        ...metrics
      };
      if (cache.size >= 30000) cache.delete(cache.keys().next().value);
      cache.set(key, plan);
      lineups.add(cards.map(c => c?.code ?? '-').join('|'));
      if (!best || comparePlans(plan, best, config, context) < 0) best = plan;
      return plan;
    }

    if (pool.length <= 10 && pool.length >= 4) {
      const permCards = [null, null, null, null];
      const usedIdx = new Set();
      function permute(pos) {
        if (pos === 4) {
          evaluate(permCards, emptyMods());
          return;
        }
        for (let i = 0; i < pool.length; i++) {
          if (usedIdx.has(i)) continue;
          usedIdx.add(i);
          permCards[pos] = pool[i];
          permute(pos + 1);
          usedIdx.delete(i);
        }
      }
      permute(0);
      if (best?.safe) return best;
    }

    const seeds = seedPlans.map(p => ({
      cards: p.cards.map(c => c ? byCode.get(c.code) ?? null : null),
      modifiers: emptyMods()
    }));
    for (let r = 0; r < config.searchRestarts; r++) seeds.push({
      cards: Array.from({ length: 4 }, (_, i) => i < pool.length ? pool[(i + r * 2) % pool.length] : null),
      modifiers: emptyMods()
    });

    const starts = seeds.map(s => evaluate(s.cards, s.modifiers)).filter(Boolean);
    let lastYield = now(), iterations = 0;
    function cooperate() {
      if (root.PacificFrontBot?.isStopped?.()) return;
      checkpoint();
      if (++iterations % 64 === 0 && now() - lastYield >= 12) {
        lastYield = now(); return yieldUI().then(checkpoint);
      }
    }

    for (const start of starts) {
      if (root.PacificFrontBot?.isStopped?.()) break;
      let current = start;

      for (let pass = 0; pass < config.searchPasses; pass++) {
        const before = current;
        for (let pos = 0; pos < 4; pos++) {
          if (root.PacificFrontBot?.isStopped?.()) break;
          checkpoint();
          let next = current;
          for (const card of pool) {
            if (current.cards.some((c, i) => i !== pos && c?.code === card.code)) continue;
            for (const allocation of allocations) {
              const cards = current.cards.slice(), mods = current.modifiers.map(a => a.slice());
              cards[pos] = card; mods[pos] = allocation;
              const candidate = evaluate(cards, mods);
              if (candidate && comparePlans(candidate, next, config, context) < 0) next = candidate;
              const pause = cooperate(); if (pause) await pause;
              if (root.PacificFrontBot?.isStopped?.()) break;
            }
            if (root.PacificFrontBot?.isStopped?.()) break;
          }
          current = next;
          await yieldUI(); checkpoint();
        }

        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
          const cards = current.cards.slice(); [cards[a], cards[b]] = [cards[b], cards[a]];
          const following = current.modifiers.map(m => m.slice()); [following[a], following[b]] = [following[b], following[a]];
          for (const mods of [current.modifiers, following]) {
            const candidate = evaluate(cards, mods);
            if (candidate && comparePlans(candidate, current, config, context) < 0) current = candidate;
            const pause = cooperate(); if (pause) await pause;
          }
        }
        if (current === before) break;
      }
      if (root.PacificFrontBot?.isStopped?.()) break;
    }

    if (!best && firstError) throw Error(firstError);
    return best ? {
      ...best, predictions: lineups.size, jointPredictions: predictions, cacheHits,
      elapsedMs: Math.round(now() - startedAt)
    } : null;
  }

  function eventPrice(price, inventory, budget) {
    if (!Array.isArray(price) || !price.length || price.some(p => p.type !== 'currency' || p.code !== 'eventum_1' || !Number.isFinite(p.amount) || p.amount <= 0)) return null;
    const cost = price.reduce((n, p) => n + p.amount, 0);
    return cost <= budget && cost <= (inventory.currencies?.eventum_1 ?? 0) ? cost : null;
  }

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
    const specs = [0, 1, 2].map(id => card.specs?.[id] ?? 0);
    const p = specs.reduce((total, value) => total + value, 0);
    return { ...card, power: p };
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
  }

  if (typeof module === 'object' && module.exports) return;
  if (!ALLOWED_ORIGINS.includes(location.origin)) return;
  if (root.PacificFrontBot) { console.info('PacificFrontBot 已加载。'); return; }

  let running = false, stopped = false, ui = null;
  const logLines = [];
  const config = { ...defaults };
  const predictionContexts = new Map();

  const log = message => {
    const text = `[${new Date().toLocaleTimeString()}] ${message}`;
    logLines.push(text); if (logLines.length > 100) logLines.shift();
    console.info('[PacificFrontBot]', message);
    if (ui) { ui.textContent = logLines.slice(-15).join('\n'); ui.scrollTop = ui.scrollHeight; }
  };

  const checkpoint = () => { if (stopped) throw Error('已由用户手动停止。'); };
  const sleep = async ms => {
    const end = Date.now() + ms;
    while (Date.now() < end) { checkpoint(); await new Promise(r => setTimeout(r, Math.min(200, end - Date.now()))); }
    checkpoint();
  };

  function validate() {
    if (!root.adeck?.predict || !root.defaultState?.settings?.collection?.cards)
      throw Error('游戏未加载完毕。请先登录、打开一个行动，等待页面显示后重试。');
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
      const data = await response.json();
      return unwrapResponse(data, path);
    } finally { clearTimeout(timer); }
  }

  async function poll(read, accept, label) {
    for (let n = 0; n < 20; n++) {
      await sleep(config.delayMs);
      const value = await read();
      if (accept(value)) return value;
    }
    throw Error(label + '等待超时。');
  }

  async function readyInventory() {
    let status = await api('inventory/status/');
    if (status.inPending) await poll(() => api('inventory/status/'), s => !s.inPending, '库存同步');
    return await api('inventory/');
  }

  const readOperation = id => api(`operation/${encodeURIComponent(id)}/`);
  const readKeypoint = id => api(`keypoint/${encodeURIComponent(id)}/`);

  async function syncBoard(id, kp, plan, required = false) {
    if (!config.syncPage && !required) return;
    try {
      let bridge = findPageBridge(document);
      const path = operationPath(location.pathname, id, kp.id);
      if (location.pathname.replace(/\/$/, '') !== path) {
        if (!bridge.router) throw Error('未找到页面路由');
        await bridge.router.navigate(path);
      }
      for (let i = 0; i < 40; i++) {
        if (stopped) return;
        bridge = findPageBridge(document);
        if (bridge.store?.getState().battleBoard?.activeKeypointId === kp.id) break;
        await sleep(200);
      }
      if (!bridge.store || bridge.store.getState().battleBoard?.activeKeypointId !== kp.id) return;
      placePageCards(bridge.store, id, kp, plan.cards, plan.modifiers, root.adeck.getModifiers?.() ?? {});
      log('已自动选卡并填入页面棋盘。');
      await sleep(500);
    } catch (error) {
      if (required) throw error;
      log(`页面选卡同步：${error.message}`);
    }
  }

  async function refreshPage(id, kp) {
    const bridge = findPageBridge(document);
    if (!bridge.queryClient) return;
    try {
      if (kp) bridge.queryClient.setQueryData?.(['keypoint', kp.id], { timestamp: Date.now() / 1000, result: kp });
      for (const queryKey of [['state'], ['operation', 'detail', id], ['inventory'], ['keypoint']])
        Promise.resolve(bridge.queryClient.invalidateQueries({ queryKey })).catch(() => {});
    } catch (error) {}
  }

  function printPlan(kp, plan, titlePrefix = '') {
    const header = titlePrefix ? `【${titlePrefix}】` : '';
    log(`${header}据点 ${kp.name ?? kp.id}：预计击败 ${plan.expected.toFixed(2)} / 4 个目标`);
    const kpSlots = slots(kp);
    plan.cards.forEach((c, i) => {
      if (!c) {
        log(`  [${i + 1}号位] 空位 / Empty`);
        return;
      }
      const rarity = getCardColor(c).label;
      const shipName = formatCardName(c);
      const mods = (plan.modifiers?.[i] ?? []).map(formatModifierName).join(' + ') || '无 / None (裸卡)';
      const hpWarn = c.health === 1 ? ' ⚠️1 HP濒死' : '';
      const slotObj = kpSlots[i];
      const rewardInfo = parseSlotReward(slotObj);
      const targetPct = (getSlotTargetRate(slotObj) * 100).toFixed(0);

      log(`  [${i + 1}号位] [${rarity}] ${shipName} (战力 ${power(c)}) | HP: ${c.health}${hpWarn} | 胜率: ${(plan.rates[i] * 100).toFixed(1)}% (目标: ${targetPct}% ${rewardInfo.label}) | 道具: [${mods}]`);
    });
  }

  // --- 空仓温馨提示：严禁擅自扣款代买，温馨提示手动买 15 个 ---
  function checkAndWarnWhiteModifierShortage(inventory, collectionModifiers) {
    const stock = modifierCounts(inventory);
    const lowStockItems = [];
    (collectionModifiers ?? []).forEach(m => {
      if (isWhiteModifier(m.id, collectionModifiers)) {
        const count = stock.get(m.id) ?? 0;
        if (count < 2) {
          lowStockItems.push(formatModifierName(m.id));
        }
      }
    });

    if (lowStockItems.length > 0) {
      log(`⚠️ [库存提示] 白色战力道具 [${lowStockItems.slice(0, 3).join('、')}${lowStockItems.length > 3 ? '等' : ''}] 储备偏低或空仓。建议手动前往商店每种各补购 15 个！当前将优先使用裸卡或库存充裕道具出战。`);
    }
  }

  // --- EpicBoss 定向武装：仅使用现存库存，绝不自动扣款代买 ---
  function equipTokenBoostersFromStock(op, choice, inventory) {
    const settings = root.defaultState.settings;
    const booster = findTokenBooster(settings.collection.modifiers);
    if (!booster) return;

    const boosterId = booster.id;
    const kpSlots = slots(choice.kp);
    const tokenSlotIndices = kpSlots.map((s, idx) => parseSlotReward(s).type === 'token' ? idx : -1).filter(idx => idx >= 0);

    if (!tokenSlotIndices.length) return;

    let counts = modifierCounts(inventory);
    let currentStock = counts.get(boosterId) ?? 0;
    const needed = tokenSlotIndices.length;

    if (currentStock < needed) {
      log(`⚠️ [代币道具提示] 决战需要 ${needed} 本【效率提升 / Progress Booster】，当前库存仅有 ${currentStock} 本！建议手动在商店买满 15 本以最大化代币收益。当前将按现存库存最大限度挂载。`);
    }

    const attrs = root.adeck.getModifiers?.() ?? {};
    const bType = attrs[boosterId]?.Type ?? 1;
    let available = currentStock;

    tokenSlotIndices.forEach(idx => {
      if (choice.plan.cards[idx] && available > 0) {
        const currentMods = choice.plan.modifiers[idx] ?? [];
        choice.plan.modifiers[idx] = [...currentMods.filter(id => attrs[id]?.Type !== bType), boosterId];
        available--;
      }
    });

    log(`✅ 已在代币掉落槽位装配 [${formatModifierName(boosterId)}]！非代币槽位严禁乱挂。`);
  }

  async function guardCriticalCardsOnly(choice) {
    for (let i = 0; i < 4; i++) {
      const card = choice.plan.cards[i];
      if (!card) continue;
      if (card.health >= 2) {
        choice.plan.modifiers[i] = (choice.plan.modifiers[i] ?? []).filter(mId => !isRepairModifier(mId, root.defaultState.settings.collection.modifiers));
      }
    }
  }

  // --- 0% 强救：若出现槽位 <50% 或 0%，彻底放宽白色战力道具与黄卡配额 ---
  async function planKeypointWithRescue(op, kp, inventory, excludedCodes = new Set(), context = {}) {
    const settings = root.defaultState.settings;
    const effects = effectPayloads(op, kp, settings.options.appliedEffectsCancelableClearThreshold ?? 1);
    const candidates = availableCards(settings.collection.cards, inventory, activeStage(op), effects, excludedCodes);
    if (!candidates.length) return null;
    const core = { ...root.adeck.newSettings(), ...settings.options.defaultCoreSettings };
    const key = JSON.stringify([core, slots(kp).map(s => s?.enemy ?? null), effects,
      [...candidates].sort((a, b) => a.code.localeCompare(b.code))]);
    if (!predictionContexts.has(key)) {
      if (predictionContexts.size >= 3) predictionContexts.delete(predictionContexts.keys().next().value);
      predictionContexts.set(key, new Map());
    }

    let plan = await optimizeJoint(root.adeck, settings, kp, candidates, effects, inventory, config, checkpoint,
      () => sleep(1), [], predictionContexts.get(key), async () => {}, { ...context, allowWhiteMods: false });

    // 0% 强救：若出现槽位 <50% 或 0%，放宽现存白色战力道具与解除配额
    if ((!plan?.safe || plan.weakestRate < 0.50 || (plan.zeroSlotCount ?? 0) > 0) && !context.isFinalBoss) {
      log(`🛟 据点 [${kp.name ?? kp.id}] 出现危急槽位(最低胜率: ${(plan?.weakestRate * 100 || 0).toFixed(1)}%)，放宽白色战力道具与解除配额救生重算！`);
      const rescuedPlan = await optimizeJoint(root.adeck, settings, kp, candidates, effects, inventory, config, checkpoint,
        () => sleep(1), plan ? [plan] : [], predictionContexts.get(key), async () => {}, { ...context, maxYMaxAllowed: 4, allowWhiteMods: true });
      if (rescuedPlan && comparePlans(rescuedPlan, plan, config, context) < 0) {
        plan = rescuedPlan;
      }
    }

    return plan;
  }

  // --- 阶段全局联合排阵（动态需求配额） ---
  async function planStageSequentially(op, stage, inventory, remainingKeypoints) {
    const sorted = [...remainingKeypoints].sort((a, b) => getKeypointThreat(b) - getKeypointThreat(a));
    const stageAssignedCodes = new Set();
    const plansMap = new Map();

    const effects = effectPayloads(op, sorted[0], root.defaultState.settings.options.appliedEffectsCancelableClearThreshold ?? 1);
    const totalAvailCards = availableCards(root.defaultState.settings.collection.cards, inventory, activeStage(op), effects);
    const totalYellowCount = totalAvailCards.filter(c => getCardColor(c).tierGroup === 'yellow').length;

    sorted.forEach((brief) => {
      const kpSlots = slots(brief);
      const heavyEnemyCount = kpSlots.filter(s => s?.enemy && power(s.enemy) >= 150).length;
      brief.maxYMaxAllowed = Math.min(totalYellowCount, Math.max(2, heavyEnemyCount));
    });

    for (const brief of sorted) {
      if (stopped) break;
      const kp = await readKeypoint(brief.id);
      const isFinalBoss = isFinalTokenBossNode(op, kp);
      const isCommonBossBattle = slots(kp).some(s => isCommonBoss(s?.enemy));
      const threat = getKeypointThreat(kp);

      const tag = isFinalBoss ? '👑 关底决战Boss/Final Epic (全黄卡主力压上/零绿道具)' :
        isCommonBossBattle ? '⚔️ 黄卡精英据点' :
        threat >= 500 ? '🛡️ 困难攻坚据点' : '⚓ 简单小怪据点';

      log(`📐 规划 [${kp.name ?? kp.id}] [${tag}]，已锁前置手牌 ${stageAssignedCodes.size} 张 (动态黄卡配额: ${brief.maxYMaxAllowed})...`);

      const context = {
        isFinalBoss, isCommonBossBattle,
        maxYMaxAllowed: isFinalBoss ? 4 : brief.maxYMaxAllowed,
        collectionMods: root.defaultState.settings.collection.modifiers
      };

      const plan = await planKeypointWithRescue(op, kp, inventory, stageAssignedCodes, context);
      if (plan && plan.cards.some(Boolean)) {
        plansMap.set(kp.id, { kp, plan, context });
        plan.cards.filter(Boolean).forEach(c => stageAssignedCodes.add(c.code));
      }
    }
    return { sorted, plansMap };
  }

  // --- 主业务工作流 ---
  async function work(mode) {
    const preview = mode === 'preview', fillOnly = mode === 'fill';
    validate();
    const state = await api('state/');
    if (state.status?.state === 'unauth') throw Error('请先登录游戏。');
    const routeId = routeInfo(location.pathname).operationId;
    const id = state.status?.operationId ?? routeId;
    if (!id) throw Error('请先在网页上进入一个行动页面。');

    let op = await readOperation(id);
    if (!op.isStarted && !preview && !fillOnly) {
      log('开始当前行动。');
      await api('operation/start/', { operationId: id });
      op = await poll(() => readOperation(id), o => o.isStarted, '行动开始');
    }

    let battles = 0;
    while (!stopped) {
      op = await readOperation(id);
      if (op.isFinished) { log('行动已全部完成！'); return; }
      const stage = activeStage(op);
      if (!stage) throw Error('没有可识别的当前阶段。');

      const remaining = stage.keypoints.filter(k => !finished(k));
      if (!remaining.length) {
        const next = op.stages[op.stages.indexOf(stage) + 1];
        if (next && !preview && !fillOnly) {
          log('🎉 当前阶段所有据点已全清！进入下一阶段...');
          await api('operation/next-stage/', {});
          await poll(() => readOperation(id), o => activeStage(o)?.id === next.id, '阶段切换');
          await refreshPage(id);
          continue;
        }
        log('所有可用阶段据点已全清。');
        return;
      }

      if (battles >= config.maxBattles) { log('已达战斗场次上限。'); return; }

      let inventory = await readyInventory();

      // 检查道具库存并在偏低时给出友好提示
      checkAndWarnWhiteModifierShortage(inventory, root.defaultState.settings.collection.modifiers);

      log(`🔄 启动当前阶段 (${remaining.length} 据点) 全局统筹规划...`);
      const { sorted, plansMap } = await planStageSequentially(op, stage, inventory, remaining);

      if (stopped) {
        const firstEntry = plansMap.values().next().value;
        if (firstEntry) {
          log('🛑 [用户中止计算] 已锁定并提取当前探索到的最大胜率方案：');
          printPlan(firstEntry.kp, firstEntry.plan, '当前最优建议阵容');
          await syncBoard(id, firstEntry.kp, firstEntry.plan, true);
        }
        log('已安全停止。');
        return;
      }

      if (fillOnly) {
        for (const [kpId, item] of plansMap) {
          await guardCriticalCardsOnly(item);
          if (item.context.isFinalBoss) {
            equipTokenBoostersFromStock(op, item, inventory);
          }
          printPlan(item.kp, item.plan, '自动选卡结果');
          await syncBoard(id, item.kp, item.plan, true);
        }
        log('✅ 当前阶段所有据点已完成全局选卡排阵，准备就绪！');
        return;
      }

      const targetBrief = sorted.find(b => plansMap.has(b.id));
      if (!targetBrief) {
        if (stageDone(stage)) {
          log('剩余据点手牌不足以稳胜，但阶段目标已达成，安全前往下一阶段。');
          const next = op.stages[op.stages.indexOf(stage) + 1];
          if (next) {
            await api('operation/next-stage/', {});
            await poll(() => readOperation(id), o => activeStage(o)?.id === next.id, '阶段切换');
            await refreshPage(id);
            continue;
          }
        }
        throw Error('没有找到满足达标线的可用阵容。');
      }

      const choice = plansMap.get(targetBrief.id);

      await guardCriticalCardsOnly(choice);

      if (choice.context.isFinalBoss) {
        equipTokenBoostersFromStock(op, choice, inventory);
      }

      printPlan(choice.kp, choice.plan, '拟出战方案');
      if (preview) { log('预览结束，未发送战斗请求。'); return; }

      await syncBoard(id, choice.kp, choice.plan, !choice.plan.safe);
      if (!choice.plan.safe) {
        log(`该据点有槽位未达动态胜率目标，已填入卡槽，暂停自动出战。`);
        return;
      }

      checkpoint();
      const battleSetup = {
        slots: choice.plan.cards.map((c, i) => c ? {
          cardCode: c.code,
          ...((choice.plan.modifiers?.[i]?.length ?? 0) > 0 ? { modifiers: choice.plan.modifiers[i] } : {})
        } : null)
      };

      log(`提交据点 [${choice.kp.name ?? choice.kp.id}] 出战...`);
      await api('keypoint/start/', { keypointId: choice.kp.id, battleSetup });
      const result = await poll(() => readKeypoint(choice.kp.id), finished, '战斗结算');
      await refreshPage(id, result);
      log(`战斗已结算：获胜 ${slots(result).filter(s => s?.outcome === 'win').length} 个位置。`);
      await sleep(config.delayMs);
      battles++;
    }
  }

  async function start(mode) {
    if (running) { log('已有任务运行中。'); return; }
    running = true; stopped = false;
    try {
      await work(mode);
    } catch (e) {
      if (e.message.includes('手动停止')) log('操作已中止。');
      else log('错误: ' + e.message);
    } finally {
      running = false;
    }
  }

  root.PacificFrontBot = {
    version: SCRIPT_VERSION, config,
    preview: () => start('preview'),
    fill: () => start('fill'),
    run: () => start('run'),
    stop: () => {
      stopped = true;
      log('已收到停止指令，正在结束计算，提取当前最佳阵容回填卡槽...');
    },
    isStopped: () => stopped,
    get running() { return running; },
    get logs() { return logLines.slice(); }
  };

  const host = document.createElement('div');
  host.id = 'pacific-front-bot-panel';
  host.style.cssText = 'position:fixed;right:20px;top:80px;width:350px;z-index:2147483647;user-select:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
<style>
:host { color: #f0f4f8; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
section {
  background: rgba(16, 33, 50, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(103, 132, 157, 0.5);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  transition: background 0.25s ease, border-color 0.25s ease;
}
section:hover {
  background: rgba(16, 33, 50, 0.92);
  border-color: rgba(103, 132, 157, 0.85);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  cursor: grab;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.header:active { cursor: grabbing; }
h3 { margin: 0; font-size: 13px; font-weight: 600; color: #a4d2ff; pointer-events: none; }
.btn-group { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
button {
  padding: 5px 9px;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  background: #2a4763;
  color: #eaf2f8;
  font-size: 12px;
  transition: background 0.15s;
}
button:hover { background: #3b638a; }
button.primary { background: #2f80ed; color: #fff; font-weight: bold; }
button.primary:hover { background: #1f6fd9; }
button.danger { background: #b03a2e; color: #fff; }
button.danger:hover { background: #922b21; }
pre {
  font: 11px/1.45 SFMono-Regular, Consolas, Monaco, monospace;
  white-space: pre-wrap;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: #c9d8e5;
  user-select: text;
}
.note { color: #8faec5; font-size: 11px; margin-bottom: 8px; }
</style>
<section>
  <div class="header" title="按住可随意拖拽窗口位置">
    <h3>Pacific Front 游玩 v${SCRIPT_VERSION} ✛</h3>
    <button id="hide" style="padding:2px 6px;font-size:11px;">收起</button>
  </div>
  <div class="note">⭐ 道具用多不用少 · 空仓提醒买15个 · 裸卡优先</div>
  <div class="btn-group">
    <button id="fill">自动选卡</button>
    <button id="run" class="primary">自动游玩</button>
    <button id="preview">仅预览</button>
    <button id="stop" class="danger">停止并选定</button>
  </div>
  <pre></pre>
</section>`;

  ui = shadow.querySelector('pre');
  shadow.querySelector('#preview').onclick = () => start('preview');
  shadow.querySelector('#fill').onclick = () => start('fill');
  shadow.querySelector('#run').onclick = () => start('run');
  shadow.querySelector('#stop').onclick = () => root.PacificFrontBot.stop();

  const hideBtn = shadow.querySelector('#hide');
  hideBtn.onclick = () => {
    ui.hidden = !ui.hidden;
    hideBtn.textContent = ui.hidden ? '展开' : '收起';
  };

  const header = shadow.querySelector('.header');
  let isDragging = false, startX, startY, origLeft, origTop;
  header.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = host.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    host.style.right = 'auto';
    host.style.left = `${origLeft}px`;
    host.style.top = `${origTop}px`;
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxLeft = window.innerWidth - host.offsetWidth - 5;
    const maxTop = window.innerHeight - host.offsetHeight - 5;
    host.style.left = `${Math.max(5, Math.min(maxLeft, origLeft + dx))}px`;
    host.style.top = `${Math.max(5, Math.min(maxTop, origTop + dy))}px`;
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  document.documentElement.append(host);
  log(`v${SCRIPT_VERSION} 已加载：道具用多不用少、空仓温馨提醒手动买15个(禁自动扣款)、裸卡后备生效。`);
})(typeof window === 'object' ? window : globalThis);
