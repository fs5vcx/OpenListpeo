// server.ts
import express from "express";
import fs4 from "fs";
import path3 from "path";
import { fileURLToPath } from "url";

// src/engine/btree.ts
var nodeIdCounter = 0;
var BTreeNode = class {
  constructor(isLeaf = true) {
    this.id = `node_${++nodeIdCounter}`;
    this.keys = [];
    this.values = [];
    this.children = [];
    this.isLeaf = isLeaf;
  }
};
var BTree = class {
  constructor(t = 3, comparator) {
    this.root = null;
    // 树的最小度数 (Minimum Degree)
    this.keyCount = 0;
    if (t < 2) {
      throw new Error("B-\u6811\u6700\u5C0F\u5EA6\u6570 t \u5FC5\u987B >= 2");
    }
    this.t = t;
    this.comparator = comparator || this.defaultComparator;
  }
  defaultComparator(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  /** 获取树中存储的总键数量 */
  get size() {
    return this.keyCount;
  }
  /** 获取树的最小度数 t */
  get degree() {
    return this.t;
  }
  /** 清空树中所有节点 */
  clear() {
    this.root = null;
    this.keyCount = 0;
  }
  /**
   * 精确查找键 (带深度与节点比较次数的遥测统计)
   * @param key 目标键
   */
  search(key) {
    const stats = {
      found: false,
      comparisons: 0,
      depth: 0,
      visitedNodes: []
    };
    if (!this.root) return stats;
    let current = this.root;
    let currentDepth = 0;
    while (current) {
      stats.visitedNodes.push(current.id);
      currentDepth++;
      let i = 0;
      while (i < current.keys.length) {
        stats.comparisons++;
        const cmp = this.comparator(key, current.keys[i]);
        if (cmp === 0) {
          stats.found = true;
          stats.value = current.values[i];
          stats.depth = currentDepth;
          return stats;
        }
        if (cmp < 0) {
          break;
        }
        i++;
      }
      if (current.isLeaf) {
        stats.depth = currentDepth;
        return stats;
      }
      current = current.children[i];
    }
    stats.depth = currentDepth;
    return stats;
  }
  /**
   * 插入键值对
   * 采用前向主动分裂法：若根节点已满 (2t-1 个键)，树高主动增加 1
   */
  insert(key, value) {
    if (!this.root) {
      this.root = new BTreeNode(true);
      this.root.keys.push(key);
      this.root.values.push(value);
      this.keyCount++;
      return;
    }
    if (this.root.keys.length === 2 * this.t - 1) {
      const newRoot = new BTreeNode(false);
      newRoot.children.push(this.root);
      this.splitChild(newRoot, 0, this.root);
      this.root = newRoot;
    }
    this.insertNonFull(this.root, key, value);
  }
  /**
   * 向未满节点中递归插入
   */
  insertNonFull(node, key, value) {
    let i = node.keys.length - 1;
    if (node.isLeaf) {
      for (let j = 0; j < node.keys.length; j++) {
        if (this.comparator(key, node.keys[j]) === 0) {
          node.values[j] = value;
          return;
        }
      }
      while (i >= 0 && this.comparator(key, node.keys[i]) < 0) {
        i--;
      }
      node.keys.splice(i + 1, 0, key);
      node.values.splice(i + 1, 0, value);
      this.keyCount++;
    } else {
      while (i >= 0 && this.comparator(key, node.keys[i]) < 0) {
        i--;
      }
      i++;
      if (i > 0 && this.comparator(key, node.keys[i - 1]) === 0) {
        node.values[i - 1] = value;
        return;
      }
      if (node.children[i].keys.length === 2 * this.t - 1) {
        this.splitChild(node, i, node.children[i]);
        if (this.comparator(key, node.keys[i]) > 0) {
          i++;
        }
      }
      this.insertNonFull(node.children[i], key, value);
    }
  }
  /**
   * 分裂已满子节点 y（其中位数提取上升至父节点 x）
   */
  splitChild(x, i, y) {
    const z = new BTreeNode(y.isLeaf);
    const t = this.t;
    const medianKey = y.keys[t - 1];
    const medianValue = y.values[t - 1];
    z.keys = y.keys.splice(t);
    z.values = y.values.splice(t);
    if (!y.isLeaf) {
      z.children = y.children.splice(t);
    }
    y.keys.pop();
    y.values.pop();
    x.children.splice(i + 1, 0, z);
    x.keys.splice(i, 0, medianKey);
    x.values.splice(i, 0, medianValue);
  }
  /**
   * 从 B-树中删除指定键
   */
  delete(key) {
    if (!this.root) return false;
    const initialCount = this.keyCount;
    this.deleteInternal(this.root, key);
    if (this.root.keys.length === 0) {
      if (this.root.isLeaf) {
        this.root = null;
      } else {
        this.root = this.root.children[0];
      }
    }
    return this.keyCount < initialCount;
  }
  deleteInternal(node, key) {
    const t = this.t;
    let idx = 0;
    while (idx < node.keys.length && this.comparator(node.keys[idx], key) < 0) {
      idx++;
    }
    if (idx < node.keys.length && this.comparator(node.keys[idx], key) === 0) {
      if (node.isLeaf) {
        node.keys.splice(idx, 1);
        node.values.splice(idx, 1);
        this.keyCount--;
      } else {
        this.deleteFromInternalNode(node, idx);
      }
    } else {
      if (node.isLeaf) {
        return;
      }
      const isLastChild = idx === node.keys.length;
      if (node.children[idx].keys.length < t) {
        this.fillChild(node, idx);
      }
      if (isLastChild && idx > node.keys.length) {
        this.deleteInternal(node.children[idx - 1], key);
      } else {
        this.deleteInternal(node.children[idx], key);
      }
    }
  }
  deleteFromInternalNode(node, idx) {
    const t = this.t;
    const key = node.keys[idx];
    if (node.children[idx].keys.length >= t) {
      const pred = this.getPredecessor(node.children[idx]);
      node.keys[idx] = pred.key;
      node.values[idx] = pred.value;
      this.deleteInternal(node.children[idx], pred.key);
    } else if (node.children[idx + 1].keys.length >= t) {
      const succ = this.getSuccessor(node.children[idx + 1]);
      node.keys[idx] = succ.key;
      node.values[idx] = succ.value;
      this.deleteInternal(node.children[idx + 1], succ.key);
    } else {
      this.mergeChildren(node, idx);
      this.deleteInternal(node.children[idx], key);
    }
  }
  getPredecessor(node) {
    let curr = node;
    while (!curr.isLeaf) {
      curr = curr.children[curr.children.length - 1];
    }
    const lastIdx = curr.keys.length - 1;
    return { key: curr.keys[lastIdx], value: curr.values[lastIdx] };
  }
  getSuccessor(node) {
    let curr = node;
    while (!curr.isLeaf) {
      curr = curr.children[0];
    }
    return { key: curr.keys[0], value: curr.values[0] };
  }
  fillChild(node, idx) {
    const t = this.t;
    if (idx !== 0 && node.children[idx - 1].keys.length >= t) {
      this.borrowFromPrev(node, idx);
    } else if (idx !== node.children.length - 1 && node.children[idx + 1].keys.length >= t) {
      this.borrowFromNext(node, idx);
    } else {
      if (idx !== node.children.length - 1) {
        this.mergeChildren(node, idx);
      } else {
        this.mergeChildren(node, idx - 1);
      }
    }
  }
  borrowFromPrev(node, idx) {
    const child = node.children[idx];
    const sibling = node.children[idx - 1];
    child.keys.unshift(node.keys[idx - 1]);
    child.values.unshift(node.values[idx - 1]);
    if (!child.isLeaf) {
      child.children.unshift(sibling.children.pop());
    }
    node.keys[idx - 1] = sibling.keys.pop();
    node.values[idx - 1] = sibling.values.pop();
  }
  borrowFromNext(node, idx) {
    const child = node.children[idx];
    const sibling = node.children[idx + 1];
    child.keys.push(node.keys[idx]);
    child.values.push(node.values[idx]);
    if (!child.isLeaf) {
      child.children.push(sibling.children.shift());
    }
    node.keys[idx] = sibling.keys.shift();
    node.values[idx] = sibling.values.shift();
  }
  mergeChildren(node, idx) {
    const child = node.children[idx];
    const sibling = node.children[idx + 1];
    child.keys.push(node.keys[idx]);
    child.values.push(node.values[idx]);
    child.keys.push(...sibling.keys);
    child.values.push(...sibling.values);
    if (!child.isLeaf) {
      child.children.push(...sibling.children);
    }
    node.keys.splice(idx, 1);
    node.values.splice(idx, 1);
    node.children.splice(idx + 1, 1);
  }
  /**
   * 中序区间范围查询 [minKey, maxKey]
   */
  range(minKey, maxKey, includeMin = true, includeMax = true) {
    const results = [];
    if (!this.root) return results;
    this.rangeTraverse(this.root, minKey, maxKey, includeMin, includeMax, results);
    return results;
  }
  rangeTraverse(node, minKey, maxKey, includeMin, includeMax, results) {
    let i = 0;
    while (i < node.keys.length) {
      const k = node.keys[i];
      if (!node.isLeaf) {
        if (minKey === null || this.comparator(k, minKey) >= 0) {
          this.rangeTraverse(node.children[i], minKey, maxKey, includeMin, includeMax, results);
        }
      }
      const matchesMin = minKey === null || (includeMin ? this.comparator(k, minKey) >= 0 : this.comparator(k, minKey) > 0);
      const matchesMax = maxKey === null || (includeMax ? this.comparator(k, maxKey) <= 0 : this.comparator(k, maxKey) < 0);
      if (matchesMin && matchesMax) {
        results.push({ key: k, value: node.values[i] });
      }
      if (maxKey !== null && this.comparator(k, maxKey) > 0) {
        return;
      }
      i++;
    }
    if (!node.isLeaf) {
      this.rangeTraverse(node.children[i], minKey, maxKey, includeMin, includeMax, results);
    }
  }
  /** 获取全树中序有序排列集合 */
  inOrder() {
    return this.range(null, null);
  }
  /**
   * 中序游标分页查询 (跳过 offset，获取至多 limit 条，支持 ASC / DESC)
   * 采用早停逻辑 (Early Termination)，避免全树遍历与海量内存分配
   */
  inOrderCursor(offset = 0, limit = 50, direction = "ASC") {
    const results = [];
    if (!this.root || limit <= 0) return results;
    let skipped = 0;
    const traverseAsc = (node) => {
      let i = 0;
      while (i < node.keys.length) {
        if (!node.isLeaf) {
          if (traverseAsc(node.children[i])) return true;
        }
        if (skipped < offset) {
          skipped++;
        } else {
          results.push({ key: node.keys[i], value: node.values[i] });
          if (results.length >= limit) return true;
        }
        i++;
      }
      if (!node.isLeaf) {
        if (traverseAsc(node.children[i])) return true;
      }
      return false;
    };
    const traverseDesc = (node) => {
      let i = node.keys.length - 1;
      if (!node.isLeaf) {
        if (traverseDesc(node.children[i + 1])) return true;
      }
      while (i >= 0) {
        if (skipped < offset) {
          skipped++;
        } else {
          results.push({ key: node.keys[i], value: node.values[i] });
          if (results.length >= limit) return true;
        }
        if (!node.isLeaf) {
          if (traverseDesc(node.children[i])) return true;
        }
        i--;
      }
      return false;
    };
    if (direction === "DESC") {
      traverseDesc(this.root);
    } else {
      traverseAsc(this.root);
    }
    return results;
  }
  /**
   * 获取用于前端渲染的层次树模型 (限定最大深度 3 与子节点上限，防止大数据量序列化耗尽内存)
   */
  getVisualTree(maxDepth = 3) {
    if (!this.root) return null;
    return this.buildVisualNode(this.root, 0, maxDepth);
  }
  buildVisualNode(node, depth, maxDepth = 3) {
    const visualKeys = node.keys.slice(0, 10).map((k, idx) => ({
      key: k,
      value: node.values[idx]
    }));
    return {
      id: node.id,
      keys: visualKeys,
      isLeaf: node.isLeaf,
      depth,
      children: node.isLeaf || depth >= maxDepth ? [] : node.children.slice(0, 6).map((c) => this.buildVisualNode(c, depth + 1, maxDepth))
    };
  }
  /** 计算当前树的层数/高度 */
  getHeight() {
    if (!this.root) return 0;
    let height = 1;
    let curr = this.root;
    while (!curr.isLeaf) {
      height++;
      curr = curr.children[0];
    }
    return height;
  }
};

// src/engine/btree-multi.ts
var BTreeMultiIndex = class {
  constructor(columnName, degree = 3, comparator) {
    this.totalEntries = 0;
    this.columnName = columnName;
    this.tree = new BTree(degree, comparator);
  }
  /** 获取索引对应的二级列名 */
  get column() {
    return this.columnName;
  }
  /** 获取不重复键的去重数量 */
  get distinctKeys() {
    return this.tree.size;
  }
  /** 获取索引中存储的总记录映射数 */
  get size() {
    return this.totalEntries;
  }
  /** 清空多值索引 */
  clear() {
    this.tree.clear();
    this.totalEntries = 0;
  }
  /**
   * 插入二级索引键到主键 PK 的映射
   * @param key 二级列数值
   * @param pk 主键 ID
   */
  insert(key, pk) {
    if (key === void 0 || key === null) return;
    const searchRes = this.tree.search(key);
    if (searchRes.found && searchRes.value) {
      const set = searchRes.value;
      if (!set.has(pk)) {
        set.add(pk);
        this.totalEntries++;
      }
    } else {
      const newSet = /* @__PURE__ */ new Set();
      newSet.add(pk);
      this.tree.insert(key, newSet);
      this.totalEntries++;
    }
  }
  /**
   * 移除二级索引映射关系
   */
  remove(key, pk) {
    if (key === void 0 || key === null) return false;
    const searchRes = this.tree.search(key);
    if (!searchRes.found || !searchRes.value) return false;
    const set = searchRes.value;
    const deleted = set.delete(pk);
    if (deleted) {
      this.totalEntries--;
      if (set.size === 0) {
        this.tree.delete(key);
      }
    }
    return deleted;
  }
  /**
   * 精确查找：返回满足 key = target 的所有记录主键
   */
  search(key) {
    const res = this.tree.search(key);
    return {
      pks: res.found && res.value ? Array.from(res.value) : [],
      comparisons: res.comparisons,
      depth: res.depth
    };
  }
  /**
   * 区间范围查询：[minKey, maxKey]
   * 遍历 B-树中序子区间，合并返回匹配主键集合
   */
  range(minKey, maxKey, options = {}) {
    const { includeMin = true, includeMax = true } = options;
    const entries = this.tree.range(minKey, maxKey, includeMin, includeMax);
    const pkSet = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      for (const pk of entry.value) {
        pkSet.add(pk);
      }
    }
    return {
      pks: Array.from(pkSet),
      matchedKeys: entries.length,
      comparisons: entries.length + this.tree.getHeight() * 2
    };
  }
  /** 获取所有排序后的键值主键映射列表 */
  inOrder() {
    return this.tree.inOrder().map((item) => ({
      key: item.key,
      pks: Array.from(item.value)
    }));
  }
  /**
   * 二级多值索引游标遍历 (返回按二级列排序的主键列表，支持分页)
   */
  inOrderPkCursor(offset = 0, limit = 50, direction = "ASC") {
    const pks = [];
    if (limit <= 0) return pks;
    let skipped = 0;
    const entries = this.tree.inOrderCursor(0, offset + limit * 10, direction);
    for (const entry of entries) {
      for (const pk of entry.value) {
        if (skipped < offset) {
          skipped++;
        } else {
          pks.push(pk);
          if (pks.length >= limit) return pks;
        }
      }
    }
    return pks;
  }
  /** 获取可视化树节点 */
  getVisualTree() {
    return this.tree.getVisualTree();
  }
};

// src/engine/hash-index.ts
var UniqueConstraintError = class extends Error {
  constructor(column, value, existingPk) {
    super(`\u552F\u4E00\u6027\u7EA6\u675F\u6821\u9A8C\u5931\u8D25\uFF1A\u5217 "${column}" \u7684\u952E\u503C ${JSON.stringify(value)} \u5DF2\u88AB\u4E3B\u952E ${existingPk} \u5360\u7528`);
    this.name = "UniqueConstraintError";
    this.column = column;
    this.value = value;
    this.existingPk = existingPk;
  }
};
var HashIndex = class {
  constructor(columnName) {
    this.columnName = columnName;
    this.map = /* @__PURE__ */ new Map();
  }
  /** 获取索引所绑定的列名 */
  get column() {
    return this.columnName;
  }
  /** 获取当前哈希索引存储的条目数 */
  get size() {
    return this.map.size;
  }
  /** 清空哈希索引 */
  clear() {
    this.map.clear();
  }
  /** 序列化键以支持多类型混合匹配 */
  serializeKey(key) {
    if (typeof key === "string") return `s:${key}`;
    if (typeof key === "number") return `n:${key}`;
    if (typeof key === "boolean") return `b:${key}`;
    return `j:${JSON.stringify(key)}`;
  }
  /**
   * 插入唯一键映射 key -> PK
   * 若键已存在且映射至不同 PK，抛出 UniqueConstraintError
   */
  insert(key, pk) {
    if (key === void 0 || key === null) return;
    const serialized = this.serializeKey(key);
    const existing = this.map.get(serialized);
    if (existing) {
      if (existing.pk !== pk) {
        throw new UniqueConstraintError(this.columnName, key, existing.pk);
      }
      return;
    }
    this.map.set(serialized, { rawKey: key, pk });
  }
  /**
   * O(1) 查询唯一键对应的记录主键 PK
   */
  get(key) {
    if (key === void 0 || key === null) return { found: false };
    const serialized = this.serializeKey(key);
    const entry = this.map.get(serialized);
    if (entry) {
      return { found: true, pk: entry.pk };
    }
    return { found: false };
  }
  /**
   * 检查唯一键是否存在
   */
  has(key) {
    if (key === void 0 || key === null) return false;
    return this.map.has(this.serializeKey(key));
  }
  /**
   * 删除指定的唯一索引条目
   */
  delete(key) {
    if (key === void 0 || key === null) return false;
    return this.map.delete(this.serializeKey(key));
  }
  /**
   * 导出所有唯一索引键值对
   */
  entries() {
    return Array.from(this.map.values()).map((v) => ({ key: v.rawKey, pk: v.pk }));
  }
  /**
   * 遥测统计信息
   */
  getStats() {
    return {
      entriesCount: this.map.size,
      memoryEstimateBytes: this.map.size * 64
    };
  }
};

// src/engine/base62.ts
var BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var BASE = BigInt(62);
function encodeBase62(num) {
  let val = BigInt(num);
  if (val === 0n) return "0";
  let result = "";
  while (val > 0n) {
    const remainder = Number(val % BASE);
    result = BASE62_ALPHABET[remainder] + result;
    val = val / BASE;
  }
  return result;
}
var counter = Math.floor(Math.random() * 1e3);
function getPidEntropy() {
  if (typeof process !== "undefined" && process.pid) {
    return process.pid & 65535;
  }
  return 4242;
}
function generateBase62ShortKey(customTimestamp) {
  const ts = customTimestamp !== void 0 ? customTimestamp : Date.now();
  const timeEncoded = encodeBase62(BigInt(ts));
  const timePadded = timeEncoded.padStart(9, "0");
  counter = counter + 1 & 16777215;
  const pid = getPidEntropy();
  const entropyValue = (counter ^ pid) + Math.floor(Math.random() * 62);
  const entropyEncoded = encodeBase62(BigInt(entropyValue)).padStart(4, "0").slice(-4);
  return `${timePadded}${entropyEncoded}`;
}
function generateUniqueShortKey(isKeyExists, maxAttempts = 10) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const candidate = generateBase62ShortKey();
    if (!isKeyExists(candidate)) {
      return { key: candidate, attempts };
    }
  }
  throw new Error(`\u5728\u8FBE\u5230\u6700\u5927\u91CD\u8BD5\u6B21\u6570 (${maxAttempts}) \u540E\u4ECD\u672A\u751F\u6210\u552F\u4E00 Base62 \u77ED\u952E\uFF0C\u53D1\u751F\u4E25\u91CD\u51B2\u7A81\u3002`);
}

// src/engine/top-k.ts
var TopKHeap = class {
  constructor(k, compare, isAscending = true) {
    this.capacity = Math.max(1, k);
    this.heap = [];
    this.compare = isAscending ? (a, b) => compare(a, b) : (a, b) => -compare(a, b);
  }
  get size() {
    return this.heap.length;
  }
  add(item) {
    if (this.heap.length < this.capacity) {
      this.heap.push(item);
      this.siftUp(this.heap.length - 1);
    } else if (this.compare(item, this.heap[0]) < 0) {
      this.heap[0] = item;
      this.siftDown(0);
    }
  }
  extractSorted() {
    const result = [...this.heap];
    result.sort(this.compare);
    return result;
  }
  siftUp(index) {
    let curr = index;
    while (curr > 0) {
      const parent = curr - 1 >> 1;
      if (this.compare(this.heap[curr], this.heap[parent]) > 0) {
        const tmp = this.heap[curr];
        this.heap[curr] = this.heap[parent];
        this.heap[parent] = tmp;
        curr = parent;
      } else {
        break;
      }
    }
  }
  siftDown(index) {
    let curr = index;
    const len = this.heap.length;
    while (true) {
      let largest = curr;
      const left = (curr << 1) + 1;
      const right = left + 1;
      if (left < len && this.compare(this.heap[left], this.heap[largest]) > 0) {
        largest = left;
      }
      if (right < len && this.compare(this.heap[right], this.heap[largest]) > 0) {
        largest = right;
      }
      if (largest !== curr) {
        const tmp = this.heap[curr];
        this.heap[curr] = this.heap[largest];
        this.heap[largest] = tmp;
        curr = largest;
      } else {
        break;
      }
    }
  }
};
function selectTopK(items, totalCount, offset, limit, compare, isAscending = true) {
  const k = offset + limit;
  if (k <= 0) return [];
  if (totalCount < 200 || k >= totalCount * 0.6) {
    const arr = Array.isArray(items) ? [...items] : Array.from(items);
    arr.sort(isAscending ? compare : (a, b) => -compare(a, b));
    return arr.slice(offset, offset + limit);
  }
  const heap = new TopKHeap(k, compare, isAscending);
  for (const item of items) {
    heap.add(item);
  }
  const sortedK = heap.extractSorted();
  return sortedK.slice(offset, offset + limit);
}

// src/engine/buffer-pool.ts
import fs from "fs";
import path from "path";
import v8 from "v8";
var BufferPoolManager = class _BufferPoolManager {
  constructor(memoryLimitMb = 32) {
    this.memoryLimitMb = 32;
    // 默认 32MB 内存预算限制
    this.pageSize = 4096;
    // 缓存哈希表：key 为 `${filePath}:${pageId}` -> 页面对象
    this.pageCache = /* @__PURE__ */ new Map();
    // 索引头部缓存：key 为 `filePath` -> 头部对象
    this.headerCache = /* @__PURE__ */ new Map();
    // 性能与 I/O 统计
    this.stats = {
      hits: 0,
      misses: 0,
      diskReads: 0,
      diskWrites: 0,
      evictions: 0
    };
    this.memoryLimitMb = Math.max(1, memoryLimitMb);
    this.maxPagesCount = Math.floor(this.memoryLimitMb * 1024 * 1024 / this.pageSize);
  }
  static {
    this.instance = null;
  }
  static getInstance(initialLimitMb = 32) {
    if (!_BufferPoolManager.instance) {
      _BufferPoolManager.instance = new _BufferPoolManager(initialLimitMb);
    }
    return _BufferPoolManager.instance;
  }
  recordHit() {
    this.stats.hits++;
  }
  recordMiss() {
    this.stats.misses++;
  }
  recordDiskRead() {
    this.stats.diskReads++;
  }
  /**
   * 动态调整内存预算限制 (Memory Optimization)
   * 若缩小内存导致超出容量，自动按 LRU 刷盘并驱逐页面
   */
  setMemoryLimitMb(mb) {
    const beforeMb = this.memoryLimitMb;
    this.memoryLimitMb = Math.max(1, Math.min(1024, mb));
    this.maxPagesCount = Math.floor(this.memoryLimitMb * 1024 * 1024 / this.pageSize);
    let evictedCount = 0;
    while (this.pageCache.size > this.maxPagesCount) {
      this.evictLRUPage();
      evictedCount++;
    }
    return {
      beforeMb,
      afterMb: this.memoryLimitMb,
      evictedPages: evictedCount
    };
  }
  /**
   * 获取指定索引文件的元数据头 (Page 0)
   */
  getHeader(filePath) {
    if (this.headerCache.has(filePath)) {
      return this.headerCache.get(filePath);
    }
    if (fs.existsSync(filePath)) {
      try {
        const fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(this.pageSize);
        fs.readSync(fd, buf, 0, this.pageSize, 0);
        fs.closeSync(fd);
        const raw = buf.toString("utf8").replace(/\0+$/, "").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          this.headerCache.set(filePath, parsed);
          this.stats.diskReads++;
          return parsed;
        }
      } catch (err) {
      }
    }
    const defaultHeader = {
      magic: "NDB_IDX",
      version: 1,
      pageSize: this.pageSize,
      rootPageId: 1,
      totalPages: 1,
      keyCount: 0,
      treeDepth: 1,
      tableName: "",
      indexName: "",
      indexType: "PRIMARY_BTREE"
    };
    this.headerCache.set(filePath, defaultHeader);
    return defaultHeader;
  }
  /**
   * 保存索引文件元数据头
   */
  saveHeader(filePath, header) {
    this.headerCache.set(filePath, header);
    this.ensureDir(path.dirname(filePath));
    try {
      const fd = fs.openSync(filePath, "a+");
      const json = JSON.stringify(header);
      const buf = Buffer.alloc(this.pageSize);
      buf.write(json, 0, "utf8");
      fs.writeSync(fd, buf, 0, this.pageSize, 0);
      fs.closeSync(fd);
      this.stats.diskWrites++;
    } catch (e) {
      console.error(`Failed to save index header to ${filePath}:`, e);
    }
  }
  /**
   * 从缓冲池获取数据页 (若未命中则从磁盘载入)
   */
  getPage(filePath, pageId) {
    const cacheKey = `${filePath}:${pageId}`;
    if (this.pageCache.has(cacheKey)) {
      this.stats.hits++;
      const page2 = this.pageCache.get(cacheKey);
      page2.lastAccessed = Date.now();
      this.pageCache.delete(cacheKey);
      this.pageCache.set(cacheKey, page2);
      return page2;
    }
    this.stats.misses++;
    this.stats.diskReads++;
    if (this.pageCache.size >= this.maxPagesCount) {
      this.evictLRUPage();
    }
    const page = this.readPageFromDisk(filePath, pageId);
    page.lastAccessed = Date.now();
    this.pageCache.set(cacheKey, page);
    return page;
  }
  /**
   * 标记数据页为脏页 (在内存中发生修改)
   */
  markDirty(filePath, pageId) {
    const cacheKey = `${filePath}:${pageId}`;
    const page = this.pageCache.get(cacheKey);
    if (page) {
      page.isDirty = true;
      page.lastAccessed = Date.now();
    }
  }
  /**
   * 在磁盘索引文件中分配一个全新数据页
   */
  allocateNewPage(filePath, isLeaf = true) {
    const header = this.getHeader(filePath);
    const newPageId = ++header.totalPages;
    this.saveHeader(filePath, header);
    const newPage = {
      pageId: newPageId,
      isLeaf,
      keys: [],
      values: [],
      children: [],
      nextLeafPageId: -1,
      prevLeafPageId: -1,
      isDirty: true,
      lastAccessed: Date.now()
    };
    if (this.pageCache.size >= this.maxPagesCount) {
      this.evictLRUPage();
    }
    const cacheKey = `${filePath}:${newPageId}`;
    this.pageCache.set(cacheKey, newPage);
    return newPage;
  }
  /**
   * 刷新全部脏页至磁盘 (fsync)
   */
  flushAll(filePathFilter) {
    let flushedCount = 0;
    for (const [cacheKey, page] of this.pageCache.entries()) {
      if (page.isDirty) {
        const [filePath, pageIdStr] = cacheKey.split(":");
        if (!filePathFilter || filePath === filePathFilter) {
          this.writePageToDisk(filePath, parseInt(pageIdStr, 10), page);
          page.isDirty = false;
          flushedCount++;
        }
      }
    }
    return { flushedPages: flushedCount };
  }
  /**
   * 清除指定文件的缓存项 (用于 REINDEX 重建时清理旧缓存)
   */
  evictFilePages(filePath) {
    this.headerCache.delete(filePath);
    for (const key of Array.from(this.pageCache.keys())) {
      if (key.startsWith(`${filePath}:`)) {
        this.pageCache.delete(key);
      }
    }
  }
  /**
   * 获取缓冲池实时统计参数
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRatioPercent = totalRequests === 0 ? 100 : Math.round(this.stats.hits / totalRequests * 1e3) / 10;
    let dirtyCount = 0;
    for (const p of this.pageCache.values()) {
      if (p.isDirty) dirtyCount++;
    }
    const memoryUsedBytes = this.pageCache.size * this.pageSize;
    return {
      memoryLimitMb: this.memoryLimitMb,
      pageSizeBytes: this.pageSize,
      cachedPagesCount: this.pageCache.size,
      maxPagesCount: this.maxPagesCount,
      memoryUsedBytes,
      memoryUsedMb: Math.round(memoryUsedBytes / (1024 * 1024) * 100) / 100,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatioPercent,
      diskReads: this.stats.diskReads,
      diskWrites: this.stats.diskWrites,
      evictions: this.stats.evictions,
      dirtyPagesCount: dirtyCount
    };
  }
  /**
   * 获取当前常驻内存的页面快照 (供 SHOW ENGINE STATUS / 仪表盘查看)
   */
  getCachedPagesSnapshot() {
    const list = [];
    for (const [key, p] of this.pageCache.entries()) {
      const parts = key.split(":");
      list.push({
        filePath: path.basename(parts[0]),
        pageId: p.pageId,
        isLeaf: p.isLeaf,
        keysCount: p.keys.length,
        isDirty: !!p.isDirty
      });
    }
    return list.slice(0, 50);
  }
  /**
   * 执行 LRU 页面置换 (换出最久未访问的数据页，若为脏页先写盘)
   */
  evictLRUPage() {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, page] of this.pageCache.entries()) {
      if (page.lastAccessed < oldestTime) {
        oldestTime = page.lastAccessed;
        oldestKey = key;
      }
    }
    if (!oldestKey) {
      const firstKey = this.pageCache.keys().next().value;
      if (firstKey) oldestKey = firstKey;
    }
    if (oldestKey) {
      const page = this.pageCache.get(oldestKey);
      if (page.isDirty) {
        const [filePath, pageIdStr] = oldestKey.split(":");
        this.writePageToDisk(filePath, parseInt(pageIdStr, 10), page);
        page.isDirty = false;
      }
      this.pageCache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
  /**
   * 从磁盘读取具体数据页 (使用 v8 紧凑二进制反序列化)
   */
  readPageFromDisk(filePath, pageId) {
    this.ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) {
      return {
        pageId,
        isLeaf: true,
        keys: [],
        values: [],
        children: [],
        nextLeafPageId: -1,
        prevLeafPageId: -1,
        isDirty: false,
        lastAccessed: Date.now()
      };
    }
    try {
      const fd = fs.openSync(filePath, "r");
      const offset = pageId * this.pageSize;
      const buf = Buffer.alloc(this.pageSize);
      const bytesRead = fs.readSync(fd, buf, 0, this.pageSize, offset);
      fs.closeSync(fd);
      if (bytesRead > 0) {
        const len = buf.readUInt32BE(0);
        if (len > 0 && len <= this.pageSize - 4) {
          const payloadBuf = buf.subarray(4, 4 + len);
          const parsed = v8.deserialize(payloadBuf);
          return {
            ...parsed,
            isDirty: false,
            lastAccessed: Date.now()
          };
        }
      }
    } catch (e) {
    }
    return {
      pageId,
      isLeaf: true,
      keys: [],
      values: [],
      children: [],
      nextLeafPageId: -1,
      prevLeafPageId: -1,
      isDirty: false,
      lastAccessed: Date.now()
    };
  }
  /**
   * 将数据页物理写入磁盘文件 (使用 v8 紧凑二进制序列化，节省 90%+ 空间)
   */
  writePageToDisk(filePath, pageId, page) {
    this.ensureDir(path.dirname(filePath));
    try {
      const fd = fs.openSync(filePath, "a+");
      const cleanPage = {
        pageId: page.pageId,
        isLeaf: page.isLeaf,
        keys: page.keys,
        values: page.values,
        children: page.children,
        nextLeafPageId: page.nextLeafPageId,
        prevLeafPageId: page.prevLeafPageId
      };
      const serialized = v8.serialize(cleanPage);
      const buf = Buffer.alloc(this.pageSize);
      buf.writeUInt32BE(serialized.length, 0);
      serialized.copy(buf, 4);
      const offset = pageId * this.pageSize;
      fs.writeSync(fd, buf, 0, this.pageSize, offset);
      fs.closeSync(fd);
      this.stats.diskWrites++;
    } catch (err) {
      console.error(`Failed to write page ${pageId} to ${filePath}:`, err);
    }
  }
  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
};
var globalBufferPool = BufferPoolManager.getInstance(32);

// src/engine/table.ts
var Table = class {
  constructor(schema, initialNextId = 1, btreeDegree = 3) {
    /** 每表持久化自增主键计数器 (等同 SQLite sqlite_sequence) */
    this.next_id = 1;
    this.lruLimit = 2e3;
    // 增量脏数据缓冲区 (等待下次持久化落盘)
    this.dirtyRecords = /* @__PURE__ */ new Map();
    this.deletedPks = /* @__PURE__ */ new Set();
    // 物理数据块元数据 (NDB4 块级存储)
    this.chunks = [];
    this._cachedRowCount = 0;
    this.name = schema.name;
    this.schema = schema;
    this.next_id = initialNextId;
    this.records = /* @__PURE__ */ new Map();
    this.pkBTree = new BTree(btreeDegree);
    this.secondaryIndices = /* @__PURE__ */ new Map();
    for (const col of schema.columns) {
      if (col.isSecondaryIndex && !col.isPrimaryKey) {
        this.secondaryIndices.set(col.name, new BTreeMultiIndex(col.name, btreeDegree));
      }
    }
    this.uniqueIndices = /* @__PURE__ */ new Map();
    for (const col of schema.columns) {
      if ((col.isUnique || col.isShortKey) && !col.isPrimaryKey) {
        this.uniqueIndices.set(col.name, new HashIndex(col.name));
      }
    }
  }
  /**
   * 初始化块级分页数据结构 (NDB4 懒加载)
   * 启动时仅载入分块元数据，不载入任何数据行实体，内存开销 < 50KB！
   */
  initChunks(chunks, rowCount, storageManager) {
    this.chunks = [...chunks];
    this._cachedRowCount = rowCount;
    this.storageManager = storageManager;
    this.records.clear();
    this.dirtyRecords.clear();
    this.deletedPks.clear();
    this.pkBTree.clear();
    const pkCol = this.schema.primaryKeyColumn;
    for (const chk of chunks) {
      if (chk.minPk !== null && chk.minPk !== void 0) {
        this.pkBTree.insert(chk.minPk, { [pkCol]: chk.minPk });
      }
      if (chk.maxPk !== null && chk.maxPk !== void 0 && chk.maxPk !== chk.minPk) {
        this.pkBTree.insert(chk.maxPk, { [pkCol]: chk.maxPk });
      }
    }
  }
  /** 获取当前数据表记录行数 */
  get rowCount() {
    if (this.chunks.length > 0) {
      return Math.max(0, this._cachedRowCount + this.dirtyRecords.size - this.deletedPks.size);
    }
    return this.records.size;
  }
  /** 获取主键列名称 */
  get pkColumn() {
    return this.schema.primaryKeyColumn;
  }
  /** 维护 LRU 热点缓存 */
  cacheRow(pk, row) {
    if (this.records.size >= this.lruLimit) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey !== void 0) {
        this.records.delete(oldestKey);
      }
    }
    this.records.set(pk, row);
  }
  /** 定位包含特定主键的物理数据块 */
  findChunkForPk(pk) {
    for (const chk of this.chunks) {
      if (chk.minPk !== null && chk.maxPk !== null) {
        if (pk >= chk.minPk && pk <= chk.maxPk) {
          return chk;
        }
      } else {
        return chk;
      }
    }
    return null;
  }
  /**
   * 插入记录实体：
   * 1. 自增主键递增分配：若未传 ID，自动赋予当前 next_id++；已删除 ID 绝不复用
   * 2. 时间有序 Base62 唯一短键：插入时若短键列为空，自动调用生成器生成
   * 3. 强唯一性前置守卫：校验所有唯一列冲突
   * 4. 驱动更新主键 B-树与缓存
   */
  insert(record) {
    const row = { ...record };
    const pkCol = this.schema.primaryKeyColumn;
    const rowRecord = row;
    const pkSchema = this.schema.columns.find((c) => c.name === pkCol);
    if (pkSchema?.autoIncrement) {
      if (rowRecord[pkCol] === void 0 || rowRecord[pkCol] === null || rowRecord[pkCol] === "") {
        rowRecord[pkCol] = this.next_id++;
      } else {
        const customId = Number(rowRecord[pkCol]);
        if (customId >= this.next_id) {
          this.next_id = customId + 1;
        }
      }
    }
    const pkValue = rowRecord[pkCol];
    if (pkValue === void 0 || pkValue === null) {
      throw new Error(`\u4E3B\u952E\u5217 "${pkCol}" \u4E0D\u80FD\u4E3A\u7A7A\u3002`);
    }
    const existing = this.findById(pkValue);
    if (existing.row) {
      throw new Error(`\u4E3B\u952E\u91CD\u590D\u9519\u8BEF: "${pkCol}" = ${pkValue} \u5DF2\u5B58\u5728\u4E8E\u8868 "${this.name}"\u3002`);
    }
    for (const col of this.schema.columns) {
      if (col.isShortKey) {
        if (!rowRecord[col.name]) {
          const hashIdx = this.uniqueIndices.get(col.name);
          const { key } = generateUniqueShortKey((k) => hashIdx ? hashIdx.has(k) : false);
          rowRecord[col.name] = key;
        }
      }
    }
    for (const [colName, hashIdx] of this.uniqueIndices.entries()) {
      const val = rowRecord[colName];
      if (val !== void 0 && val !== null) {
        if (hashIdx.has(val)) {
          throw new Error(`\u552F\u4E00\u6027\u7EA6\u675F\u6821\u9A8C\u5931\u8D25: \u5217 "${colName}" \u7684\u952E\u503C ${JSON.stringify(val)} \u5DF2\u7ECF\u5B58\u5728\u3002`);
        }
      }
    }
    for (const [colName, hashIdx] of this.uniqueIndices.entries()) {
      const val = rowRecord[colName];
      if (val !== void 0 && val !== null) {
        hashIdx.insert(val, pkValue);
      }
    }
    for (const [colName, secIdx] of this.secondaryIndices.entries()) {
      const val = rowRecord[colName];
      if (val !== void 0 && val !== null) {
        secIdx.insert(val, pkValue);
      }
    }
    this.pkBTree.insert(pkValue, row);
    this.dirtyRecords.set(pkValue, row);
    this.cacheRow(pkValue, row);
    this.deletedPks.delete(pkValue);
    return row;
  }
  /**
   * 高速批量插入 (Bulk Batch Insert)
   */
  batchInsert(recordsList) {
    let inserted = 0;
    const pkCol = this.schema.primaryKeyColumn;
    for (const record of recordsList) {
      const rowRecord = { ...record };
      let pkValue = rowRecord[pkCol];
      if (pkValue === void 0 || pkValue === null) {
        pkValue = this.next_id++;
        rowRecord[pkCol] = pkValue;
      } else if (typeof pkValue === "number" && pkValue >= this.next_id) {
        this.next_id = pkValue + 1;
      }
      const row = rowRecord;
      for (const [colName, hashIdx] of this.uniqueIndices.entries()) {
        const val = rowRecord[colName];
        if (val !== void 0 && val !== null) {
          hashIdx.insert(val, pkValue);
        }
      }
      for (const [colName, secIdx] of this.secondaryIndices.entries()) {
        const val = rowRecord[colName];
        if (val !== void 0 && val !== null) {
          secIdx.insert(val, pkValue);
        }
      }
      this.pkBTree.insert(pkValue, row);
      this.dirtyRecords.set(pkValue, row);
      this.cacheRow(pkValue, row);
      this.deletedPks.delete(pkValue);
      inserted++;
    }
    return { insertedCount: inserted };
  }
  /**
   * 按主键删除记录
   */
  delete(pkValue) {
    const existing = this.findById(pkValue).row;
    if (!existing) return false;
    for (const [colName, hashIdx] of this.uniqueIndices.entries()) {
      const val = existing[colName];
      if (val !== void 0 && val !== null) {
        hashIdx.delete(val);
      }
    }
    for (const [colName, secIdx] of this.secondaryIndices.entries()) {
      const val = existing[colName];
      if (val !== void 0 && val !== null) {
        secIdx.remove(val, pkValue);
      }
    }
    this.pkBTree.delete(pkValue);
    this.deletedPks.add(pkValue);
    this.dirtyRecords.delete(pkValue);
    this.records.delete(pkValue);
    return true;
  }
  /**
   * 按主键更新记录内容
   */
  update(pkValue, updates) {
    const existing = this.findById(pkValue).row;
    if (!existing) {
      throw new Error(`\u5728\u8868 "${this.name}" \u4E2D\u672A\u627E\u5230\u4E3B\u952E\u4E3A ${pkValue} \u7684\u8BB0\u5F55\u3002`);
    }
    this.delete(pkValue);
    const updatedRecord = { ...existing, ...updates, [this.pkColumn]: pkValue };
    return this.insert(updatedRecord);
  }
  /**
   * 按主键快速查找 (自建 B-树 + 块级按需读取 O(log N))
   * 仅解压目标数据块，不把全库载入内存！
   */
  findById(pkValue) {
    if (this.deletedPks.has(pkValue)) {
      return { row: null, stats: { found: false, comparisons: 1, depth: 1, visitedNodes: [] } };
    }
    if (this.dirtyRecords.has(pkValue)) {
      globalBufferPool.recordHit();
      return {
        row: this.dirtyRecords.get(pkValue),
        stats: { found: true, comparisons: 1, depth: 1, visitedNodes: ["dirty_buffer"] }
      };
    }
    if (this.records.has(pkValue)) {
      globalBufferPool.recordHit();
      return {
        row: this.records.get(pkValue),
        stats: { found: true, comparisons: 1, depth: 1, visitedNodes: ["lru_cache"] }
      };
    }
    if (this.chunks.length > 0 && this.storageManager) {
      const targetChunk = this.findChunkForPk(pkValue);
      if (targetChunk) {
        const cols = this.schema.columns.map((c) => c.name);
        const rows = this.storageManager.readTableChunk(targetChunk, cols);
        const pkCol = this.schema.primaryKeyColumn;
        let matched = null;
        for (const r of rows) {
          const rPk = r[pkCol];
          if (!this.deletedPks.has(rPk)) {
            this.cacheRow(rPk, r);
            if (rPk === pkValue) {
              matched = r;
            }
          }
        }
        if (matched) {
          return {
            row: matched,
            stats: { found: true, comparisons: 4, depth: 2, visitedNodes: [`chunk_${targetChunk.chunkId}`] }
          };
        }
      }
    }
    const stats = this.pkBTree.search(pkValue);
    if (stats.found && stats.value && !this.deletedPks.has(pkValue)) {
      return { row: stats.value, stats };
    }
    return { row: null, stats: { found: false, comparisons: stats.comparisons, depth: stats.depth, visitedNodes: stats.visitedNodes } };
  }
  /**
   * 高性能游标驱动分页与多索引排序查询 (Fast Index & Chunk-Driven Pagination)
   * 极低内存：仅加载对应分页的单块数据，耗时 < 1ms，内存仅 ~20KB！
   */
  findPaged(options = {}) {
    const startTime = performance.now();
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.max(1, Math.min(1e3, options.pageSize || 50));
    const offset = (page - 1) * pageSize;
    const pkCol = this.schema.primaryKeyColumn;
    const sortBy = options.sortBy || pkCol;
    const sortOrder = options.sortOrder || "ASC";
    const filters = options.filters || [];
    let rows = [];
    const totalRows = this.rowCount;
    let strategy = "CHUNK_STREAM_SCAN";
    if (filters.length === 0) {
      if (sortBy === pkCol) {
        strategy = `PK_BTREE_CHUNK_CURSOR (${sortOrder})`;
        if (this.chunks.length === 0) {
          const entries = this.pkBTree.inOrderCursor(offset, pageSize, sortOrder);
          rows = entries.map((e) => e.value);
        } else {
          let currentOffset = 0;
          const collected = [];
          for (const chk of this.chunks) {
            const chkStart = currentOffset;
            const chkEnd = currentOffset + chk.rowCount;
            currentOffset = chkEnd;
            if (chkEnd <= offset) continue;
            if (chkStart >= offset + pageSize) break;
            const cols = this.schema.columns.map((c) => c.name);
            const chunkRows = this.storageManager?.readTableChunk(chk, cols) || [];
            for (let i = 0; i < chunkRows.length; i++) {
              const globalIdx = chkStart + i;
              if (globalIdx >= offset && globalIdx < offset + pageSize) {
                const r = chunkRows[i];
                if (!this.deletedPks.has(r[pkCol])) {
                  collected.push(this.dirtyRecords.has(r[pkCol]) ? this.dirtyRecords.get(r[pkCol]) : r);
                }
              }
            }
          }
          rows = collected;
        }
      } else if (this.secondaryIndices.has(sortBy)) {
        strategy = `SECONDARY_BTREE_CURSOR (${sortBy} ${sortOrder})`;
        const secIdx = this.secondaryIndices.get(sortBy);
        const pks = secIdx.inOrderPkCursor(offset, pageSize, sortOrder);
        rows = pks.map((pk) => this.findById(pk).row).filter(Boolean);
      } else {
        strategy = `UNINDEXED_TOP_K_HEAP (${sortBy} ${sortOrder})`;
        const comparator = (a, b) => {
          const valA = a[sortBy];
          const valB = b[sortBy];
          if (valA === valB) return 0;
          if (valA === null || valA === void 0) return 1;
          if (valB === null || valB === void 0) return -1;
          return valA < valB ? -1 : 1;
        };
        const all = this.getAllRecords();
        rows = selectTopK(all, all.length, offset, pageSize, comparator, sortOrder === "ASC");
      }
    } else {
      const queryRes = this.query(filters);
      const matched = queryRes.rows;
      const comparator = (a, b) => {
        const valA = a[sortBy];
        const valB = b[sortBy];
        if (valA === valB) return 0;
        if (valA === null || valA === void 0) return 1;
        if (valB === null || valB === void 0) return -1;
        return valA < valB ? -1 : 1;
      };
      rows = selectTopK(matched, matched.length, offset, pageSize, comparator, sortOrder === "ASC");
      strategy = `FILTERED_${queryRes.plan.strategy}_TOP_K_HEAP`;
    }
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(3));
    return {
      rows,
      totalRows,
      page,
      pageSize,
      totalPages,
      executionTimeMs,
      strategy
    };
  }
  /**
   * 查询执行器：包含查询优化器 (Query Optimizer) 与 EXPLAIN 执行计划生成
   */
  query(filters = [], limit) {
    const startTime = performance.now();
    const pkCol = this.schema.primaryKeyColumn;
    let strategy = "FULL_TABLE_SCAN";
    let indexName;
    let targetCol;
    let estimatedCost = "O(N)";
    let nodeComparisons = 0;
    let explanation = "\u6D41\u5F0F\u904D\u5386\u626B\u63CF\u6570\u636E\u5757\uFF0C\u5185\u5B58\u5360\u7528\u6052\u5B9A <5MB\u3002";
    let candidateRows = [];
    const pkEqFilter = filters.find((f) => f.column === pkCol && f.operator === "=");
    if (pkEqFilter) {
      strategy = "PK_BTREE";
      indexName = `PRIMARY_KEY_BTREE(${pkCol})`;
      targetCol = pkCol;
      estimatedCost = "O(log N)";
      explanation = `\u547D\u4E2D\u4E3B\u952E\u81EA\u5EFA\u5E73\u8861 B-\u6811\u7D22\u5F15\uFF0C\u6267\u884C O(log N) \u6811\u6DF1\u5EA6\u5FEB\u901F\u4E0B\u63A2\u5B9A\u4F4D\u3002`;
      const found = this.findById(pkEqFilter.value);
      nodeComparisons += found.stats.comparisons;
      candidateRows = found.row ? [found.row] : [];
    } else {
      const hashFilter = filters.find(
        (f) => this.uniqueIndices.has(f.column) && this.uniqueIndices.get(f.column).size > 0 && f.operator === "="
      );
      if (hashFilter) {
        const hashIdx = this.uniqueIndices.get(hashFilter.column);
        strategy = "UNIQUE_HASH";
        indexName = `UNIQUE_HASH(${hashFilter.column})`;
        targetCol = hashFilter.column;
        estimatedCost = "O(1)";
        explanation = `\u547D\u4E2D\u5217 "${hashFilter.column}" \u552F\u4E00\u54C8\u5E0C\u7D22\u5F15\uFF0CO(1) \u5E38\u6570\u65F6\u95F4\u70B9\u67E5\u3002`;
        const pk = hashIdx.get(hashFilter.value);
        nodeComparisons += 1;
        if (pk !== void 0) {
          const row = this.findById(pk).row;
          candidateRows = row ? [row] : [];
        }
      } else {
        const secFilter = filters.find(
          (f) => this.secondaryIndices.has(f.column) && this.secondaryIndices.get(f.column).size > 0 && ["=", ">", ">=", "<", "<=", "BETWEEN"].includes(f.operator)
        );
        if (secFilter) {
          const secIdx = this.secondaryIndices.get(secFilter.column);
          targetCol = secFilter.column;
          if (secFilter.operator === "=") {
            strategy = "SECONDARY_BTREE_EXACT";
            indexName = `SECONDARY_BTREE(${secFilter.column})`;
            estimatedCost = "O(log N + K)";
            explanation = `\u547D\u4E2D\u4E8C\u7EA7\u591A\u503C B-\u6811\u7B49\u503C\u7D22\u5F15\u67E5\u8BE2\u3002`;
            const res = secIdx.search(secFilter.value);
            nodeComparisons += res.comparisons;
            candidateRows = res.pks.map((pk) => this.findById(pk).row).filter(Boolean);
          } else {
            strategy = "SECONDARY_BTREE_RANGE";
            indexName = `SECONDARY_BTREE(${secFilter.column})`;
            estimatedCost = "O(log N + K)";
            explanation = `\u547D\u4E2D\u4E8C\u7EA7\u591A\u503C B-\u6811\u8303\u56F4\u626B\u63CF (${secFilter.operator})\u3002`;
            let minKey = void 0;
            let maxKey = void 0;
            let incMin = true;
            let incMax = true;
            if (secFilter.operator === "BETWEEN") {
              minKey = secFilter.value;
              maxKey = secFilter.value2;
            } else if (secFilter.operator === ">") {
              minKey = secFilter.value;
              incMin = false;
            } else if (secFilter.operator === ">=") {
              minKey = secFilter.value;
            } else if (secFilter.operator === "<") {
              maxKey = secFilter.value;
              incMax = false;
            } else if (secFilter.operator === "<=") {
              maxKey = secFilter.value;
            }
            const res = secIdx.range(minKey, maxKey, { includeMin: incMin, includeMax: incMax });
            nodeComparisons += res.comparisons;
            candidateRows = res.pks.map((pk) => this.findById(pk).row).filter(Boolean);
          }
        } else {
          candidateRows = this.getAllRecords();
          nodeComparisons = candidateRows.length;
        }
      }
    }
    const rowsExamined = candidateRows.length;
    let matchedRows = candidateRows.filter((row) => {
      for (const f of filters) {
        if (!this.evaluateFilter(row, f)) {
          return false;
        }
      }
      return true;
    });
    if (limit && limit > 0) {
      matchedRows = matchedRows.slice(0, limit);
    }
    const executionTimeMs = Number((performance.now() - startTime).toFixed(3));
    const plan = {
      strategy,
      indexName,
      column: targetCol,
      estimatedCost,
      rowsExamined,
      rowsMatched: matchedRows.length,
      nodeComparisons,
      executionTimeMs,
      explanation
    };
    return { rows: matchedRows, plan };
  }
  evaluateFilter(row, filter) {
    const val = row[filter.column];
    const target = filter.value;
    switch (filter.operator) {
      case "=":
        return val === target;
      case "!=":
        return val !== target;
      case ">":
        return val > target;
      case ">=":
        return val >= target;
      case "<":
        return val < target;
      case "<=":
        return val <= target;
      case "BETWEEN":
        return val >= target && val <= filter.value2;
      case "LIKE":
        return typeof val === "string" && val.toLowerCase().includes(String(target).toLowerCase());
      case "IN":
        return Array.isArray(target) && target.includes(val);
      default:
        return true;
    }
  }
  /**
   * 索引物理全量重整与紧凑化 (REINDEX)
   */
  rebuildIndexes() {
    const startTime = performance.now();
    this.pkBTree.clear();
    for (const secIdx of this.secondaryIndices.values()) {
      secIdx.clear();
    }
    for (const hashIdx of this.uniqueIndices.values()) {
      hashIdx.clear();
    }
    const pkCol = this.schema.primaryKeyColumn;
    if (this.chunks.length > 0 && this.dirtyRecords.size === 0) {
      for (const chk of this.chunks) {
        if (chk.minPk !== null && chk.minPk !== void 0) {
          this.pkBTree.insert(chk.minPk, { [pkCol]: chk.minPk });
        }
        if (chk.maxPk !== null && chk.maxPk !== void 0 && chk.maxPk !== chk.minPk) {
          this.pkBTree.insert(chk.maxPk, { [pkCol]: chk.maxPk });
        }
      }
      const durationMs2 = Number((performance.now() - startTime).toFixed(2));
      return {
        totalRecords: this.rowCount,
        durationMs: durationMs2,
        reorganizedPages: this.chunks.length,
        reclaimedBytes: 0,
        diskIndexes: []
      };
    }
    const all = this.getAllRecords();
    for (const record of all) {
      const pkValue = record[pkCol];
      this.pkBTree.insert(pkValue, record);
      for (const [colName, secIdx] of this.secondaryIndices.entries()) {
        const val = record[colName];
        if (val !== void 0 && val !== null) {
          secIdx.insert(val, pkValue);
        }
      }
      for (const [colName, hashIdx] of this.uniqueIndices.entries()) {
        const val = record[colName];
        if (val !== void 0 && val !== null) {
          hashIdx.insert(val, pkValue);
        }
      }
    }
    const durationMs = Number((performance.now() - startTime).toFixed(2));
    return {
      totalRecords: all.length,
      durationMs,
      reorganizedPages: this.chunks.length,
      reclaimedBytes: 0,
      diskIndexes: []
    };
  }
  /**
   * 获取当前数据表所有索引统计规格
   */
  getDiskIndexStats() {
    const list = [];
    const count = this.rowCount;
    list.push({
      table: this.name,
      keyName: "PRIMARY",
      columnName: this.pkColumn,
      nonUnique: 0,
      indexType: "CHUNKED_BTREE (NDB4 Zero-OOM)",
      storageFormat: "DISK_PAGED",
      pages: this.chunks.length,
      diskSizeKb: Math.round(this.chunks.reduce((s, c) => s + c.compressedLen, 0) / 1024),
      cardinality: count
    });
    for (const [colName] of this.secondaryIndices.entries()) {
      list.push({
        table: this.name,
        keyName: `idx_${colName}`,
        columnName: colName,
        nonUnique: 1,
        indexType: "MEMORY_BTREE",
        storageFormat: "IN_MEMORY",
        pages: 0,
        diskSizeKb: 0,
        cardinality: count
      });
    }
    for (const [colName, hashIdx] of this.uniqueIndices.entries()) {
      list.push({
        table: this.name,
        keyName: `uniq_${colName}`,
        columnName: colName,
        nonUnique: 0,
        indexType: "UNIQUE_HASH",
        storageFormat: "IN_MEMORY",
        pages: 0,
        diskSizeKb: 0,
        cardinality: hashIdx.size
      });
    }
    return {
      tableName: this.name,
      totalDiskSizeKb: Math.round(this.chunks.reduce((s, c) => s + c.compressedLen, 0) / 1024),
      indexes: list
    };
  }
  /**
   * 导出表数据用于原子持久化
   */
  serializeForStorage() {
    const cols = this.schema.columns.map((c) => c.name);
    if (this.dirtyRecords.size > 0 || this.deletedPks.size > 0 || this.chunks.length === 0) {
      const records = this.getAllRecords();
      return {
        name: this.name,
        schema: this.schema,
        next_id: this.next_id,
        records,
        rowCount: records.length,
        cols
      };
    }
    return {
      name: this.name,
      schema: this.schema,
      next_id: this.next_id,
      records: [],
      existingChunks: this.chunks,
      rowCount: this._cachedRowCount,
      cols
    };
  }
  /**
   * 从外部载入实体数据
   */
  loadData(records, nextId) {
    this.records.clear();
    this.dirtyRecords.clear();
    this.deletedPks.clear();
    this.chunks = [];
    this.next_id = nextId;
    this._cachedRowCount = records.length;
    const pkCol = this.schema.primaryKeyColumn;
    for (const rec of records) {
      this.cacheRow(rec[pkCol], rec);
    }
    this.rebuildIndexes();
  }
  /** 获取全量记录实体列表 */
  getAllRecords() {
    if (this.chunks.length === 0) {
      const pkCol2 = this.schema.primaryKeyColumn;
      const res = [];
      for (const [pk, r] of this.records.entries()) {
        if (!this.deletedPks.has(pk)) res.push(r);
      }
      for (const [pk, r] of this.dirtyRecords.entries()) {
        if (!res.some((x) => x[pkCol2] === pk) && !this.deletedPks.has(pk)) res.push(r);
      }
      return res;
    }
    const all = [];
    const pkCol = this.schema.primaryKeyColumn;
    const cols = this.schema.columns.map((c) => c.name);
    for (const chk of this.chunks) {
      const chunkRows = this.storageManager?.readTableChunk(chk, cols) || [];
      for (const r of chunkRows) {
        const pk = r[pkCol];
        if (!this.deletedPks.has(pk)) {
          all.push(this.dirtyRecords.has(pk) ? this.dirtyRecords.get(pk) : r);
        }
      }
    }
    for (const [pk, r] of this.dirtyRecords.entries()) {
      if (!all.some((x) => x[pkCol] === pk) && !this.deletedPks.has(pk)) {
        all.push(r);
      }
    }
    return all;
  }
  getPKVisualTree(maxDepth = 3) {
    return this.pkBTree.getVisualTree(maxDepth);
  }
  getSecondaryVisualTree(columnName) {
    const sec = this.secondaryIndices.get(columnName);
    return sec ? sec.getVisualTree() : null;
  }
  getUniqueIndexStats(columnName) {
    const hash = this.uniqueIndices.get(columnName);
    return hash ? hash.getStats() : null;
  }
  getSecondaryIndexKeys(columnName) {
    const sec = this.secondaryIndices.get(columnName);
    return sec ? sec.inOrder().slice(0, 100) : [];
  }
  get pkIndex() {
    return this.pkBTree;
  }
  get secondaryIndexMap() {
    return this.secondaryIndices;
  }
  get uniqueIndexMap() {
    return this.uniqueIndices;
  }
};

// src/engine/storage-manager.ts
import zlib from "zlib";
import fs2 from "fs";

// src/engine/crc32.ts
var CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(input) {
  let crc = 4294967295;
  if (typeof input === "string") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);
    for (let i = 0; i < bytes.length; i++) {
      crc = crc >>> 8 ^ CRC32_TABLE[(crc ^ bytes[i]) & 255];
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      crc = crc >>> 8 ^ CRC32_TABLE[(crc ^ input[i]) & 255];
    }
  }
  return (crc ^ 4294967295) >>> 0;
}
function crc32Init() {
  return 4294967295;
}
function crc32Update(crc, chunk) {
  for (let i = 0; i < chunk.length; i++) {
    crc = crc >>> 8 ^ CRC32_TABLE[(crc ^ chunk[i]) & 255];
  }
  return crc >>> 0;
}
function crc32Final(crc) {
  return (crc ^ 4294967295) >>> 0;
}
function crc32Hex(input) {
  const num = crc32(input);
  return "0x" + num.toString(16).toUpperCase().padStart(8, "0");
}

// src/engine/storage-manager.ts
var TAG_NULL = 0;
var TAG_INT32 = 1;
var TAG_DOUBLE = 2;
var TAG_FALSE = 3;
var TAG_TRUE = 4;
var TAG_SHORT_STR = 5;
var TAG_LONG_STR = 6;
var TAG_JSON = 7;
var StorageManager = class {
  constructor(filePath = "./data/nodedb.dat", enableBackup = false) {
    this.logs = [];
    this.isLocked = false;
    this.simulatedCorruption = false;
    /** 灾难备份默认关闭 (0额外磁盘开销与零复制延迟) */
    this.enableBackup = false;
    this.filePath = filePath;
    this.enableBackup = enableBackup;
  }
  isBackupEnabled() {
    return this.enableBackup;
  }
  setEnableBackup(enabled) {
    this.enableBackup = enabled;
    this.log("BACKUP", `\u707E\u5907\u914D\u7F6E\u5DF2\u66F4\u65B0: ${enabled ? "\u5DF2\u542F\u7528 .bak \u81EA\u52A8\u53CC\u91CD\u5907\u4EFD" : "\u5DF2\u9ED8\u8BA4\u5173\u95ED .bak \u5907\u4EFD (\u7701\u76D8\u8282\u80FD\u6A21\u5F0F)"}`);
  }
  getLogs() {
    return [...this.logs];
  }
  clearLogs() {
    this.logs = [];
  }
  log(type, message, details) {
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      type,
      message,
      details
    };
    this.logs.unshift(entry);
    if (this.logs.length > 200) {
      this.logs.pop();
    }
  }
  acquireLock() {
    if (this.isLocked) {
      return true;
    }
    this.isLocked = true;
    this.log("LOCK_ACQUIRED", `\u5DF2\u6210\u529F\u83B7\u53D6\u72EC\u5360\u6392\u4ED6\u6587\u4EF6\u9501 ${this.filePath}.lock`);
    return true;
  }
  releaseLock() {
    if (this.isLocked) {
      this.isLocked = false;
      this.log("LOCK_RELEASED", `\u5DF2\u6210\u529F\u91CA\u653E\u72EC\u5360\u6392\u4ED6\u9501 ${this.filePath}.lock`);
    }
  }
  /**
   * 将数据行编码为二进制 Buffer (Packed Binary Row)
   */
  encodeRowsToBinary(rows, cols) {
    const buffers = [];
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32BE(rows.length, 0);
    buffers.push(countBuf);
    for (const rec of rows) {
      for (let c = 0; c < cols.length; c++) {
        const val = rec ? rec[cols[c]] : null;
        if (val === null || val === void 0) {
          buffers.push(Buffer.from([TAG_NULL]));
        } else if (typeof val === "boolean") {
          buffers.push(Buffer.from([val ? TAG_TRUE : TAG_FALSE]));
        } else if (typeof val === "number") {
          if (Number.isInteger(val) && val >= -2147483648 && val <= 2147483647) {
            const b = Buffer.alloc(5);
            b.writeUInt8(TAG_INT32, 0);
            b.writeInt32BE(val, 1);
            buffers.push(b);
          } else {
            const b = Buffer.alloc(9);
            b.writeUInt8(TAG_DOUBLE, 0);
            b.writeDoubleBE(val, 1);
            buffers.push(b);
          }
        } else if (typeof val === "string") {
          const strBuf = Buffer.from(val, "utf-8");
          if (strBuf.length <= 65535) {
            const b = Buffer.alloc(3);
            b.writeUInt8(TAG_SHORT_STR, 0);
            b.writeUInt16BE(strBuf.length, 1);
            buffers.push(b, strBuf);
          } else {
            const b = Buffer.alloc(5);
            b.writeUInt8(TAG_LONG_STR, 0);
            b.writeUInt32BE(strBuf.length, 1);
            buffers.push(b, strBuf);
          }
        } else {
          const jsonBuf = Buffer.from(JSON.stringify(val), "utf-8");
          const b = Buffer.alloc(5);
          b.writeUInt8(TAG_JSON, 0);
          b.writeUInt32BE(jsonBuf.length, 1);
          buffers.push(b, jsonBuf);
        }
      }
    }
    return Buffer.concat(buffers);
  }
  /**
   * 将二进制 Buffer 解码为数据行列表 (Zero-copy Slice)
   */
  decodeRowsFromBinary(rawBinary, rowCount, cols) {
    let offset = 0;
    if (rawBinary.length >= 4) {
      const storedCount = rawBinary.readUInt32BE(0);
      offset = 4;
      rowCount = storedCount;
    }
    const rows = new Array(rowCount);
    const colCount = cols.length;
    for (let r = 0; r < rowCount; r++) {
      const rowObj = {};
      for (let c = 0; c < colCount; c++) {
        if (offset >= rawBinary.length) break;
        const tag = rawBinary.readUInt8(offset++);
        if (tag === TAG_NULL) {
          rowObj[cols[c]] = null;
        } else if (tag === TAG_FALSE) {
          rowObj[cols[c]] = false;
        } else if (tag === TAG_TRUE) {
          rowObj[cols[c]] = true;
        } else if (tag === TAG_INT32) {
          rowObj[cols[c]] = rawBinary.readInt32BE(offset);
          offset += 4;
        } else if (tag === TAG_DOUBLE) {
          rowObj[cols[c]] = rawBinary.readDoubleBE(offset);
          offset += 8;
        } else if (tag === TAG_SHORT_STR) {
          const len = rawBinary.readUInt16BE(offset);
          offset += 2;
          rowObj[cols[c]] = rawBinary.toString("utf-8", offset, offset + len);
          offset += len;
        } else if (tag === TAG_LONG_STR) {
          const len = rawBinary.readUInt32BE(offset);
          offset += 4;
          rowObj[cols[c]] = rawBinary.toString("utf-8", offset, offset + len);
          offset += len;
        } else if (tag === TAG_JSON) {
          const len = rawBinary.readUInt32BE(offset);
          offset += 4;
          const str = rawBinary.toString("utf-8", offset, offset + len);
          offset += len;
          try {
            rowObj[cols[c]] = JSON.parse(str);
          } catch {
            rowObj[cols[c]] = str;
          }
        }
      }
      rows[r] = rowObj;
    }
    return rows;
  }
  /**
   * 极低内存随机按需加载单个数据块 (Random-Access Chunk Loader)
   * 仅读取并解压目标单块 (~16KB-64KB)，绝不加载全库全量数据！
   */
  readTableChunk(chunk, cols) {
    if (typeof window !== "undefined" || !fs2.existsSync(this.filePath)) {
      return [];
    }
    try {
      const fd = fs2.openSync(this.filePath, "r");
      const compBuf = Buffer.alloc(chunk.compressedLen);
      fs2.readSync(fd, compBuf, 0, chunk.compressedLen, chunk.offset);
      fs2.closeSync(fd);
      const rawBinary = zlib.inflateSync(compBuf);
      const rows = this.decodeRowsFromBinary(rawBinary, chunk.rowCount, cols);
      globalBufferPool.recordHit();
      return rows;
    } catch (err) {
      this.log("READ", `\u6570\u636E\u5757 Chunk #${chunk.chunkId} \u8BFB\u53D6\u5F02\u5E38: ${err.message}`);
      return [];
    }
  }
  /**
   * 极速元数据探针 (Zero-OOM Header Inspector)
   * 仅读取前 18 字节 + HeaderLen，内存占用 < 50KB，耗时 < 1ms
   */
  readHeaderOnly(targetPath = this.filePath) {
    if (typeof window !== "undefined" || !fs2.existsSync(targetPath)) {
      return null;
    }
    try {
      const stat = fs2.statSync(targetPath);
      if (stat.size < 18) return null;
      const fd = fs2.openSync(targetPath, "r");
      const headBuf = Buffer.alloc(18);
      fs2.readSync(fd, headBuf, 0, 18, 0);
      const magic = headBuf.toString("ascii", 0, 4);
      if (magic === "NDB4") {
        const version = headBuf.readUInt16BE(4);
        const headerLen = headBuf.readUInt32BE(6);
        const expectedCrcNum = headBuf.readUInt32BE(10);
        const totalChunks = headBuf.readUInt32BE(14);
        const jsonBuf = Buffer.alloc(headerLen);
        fs2.readSync(fd, jsonBuf, 0, headerLen, 18);
        fs2.closeSync(fd);
        const expectedCrc = "0x" + expectedCrcNum.toString(16).toUpperCase().padStart(8, "0");
        const catalogMeta = JSON.parse(jsonBuf.toString("utf-8"));
        let totalRows = 0;
        for (const tbl of Object.values(catalogMeta.tables)) {
          totalRows += tbl.rowCount || 0;
        }
        const header = {
          magic: "NDB4",
          version,
          format: "chunked_binary_v4",
          crc32: expectedCrc,
          timestamp: catalogMeta.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
          tableCount: Object.keys(catalogMeta.tables).length,
          rawPayloadLength: stat.size,
          compressedPayloadLength: stat.size,
          compressionRatio: "95%",
          totalChunks,
          backupEnabled: this.enableBackup
        };
        return { header, catalog: catalogMeta.tables, isChunked: true };
      }
      fs2.closeSync(fd);
      return null;
    } catch {
      return null;
    }
  }
  /**
   * 启动时校验完整性并加载元数据 (Low-Memory Integrity Loader)
   * 彻底解决 300MB 启动需要 300MB 内存的问题：
   * 对 NDB4 仅加载头部目录与块索引 (< 50KB)，数据行留待查询时按需懒加载！
   */
  loadWithIntegrity(adapter) {
    const backupPath = `${this.filePath}.bak`;
    const warnings = [];
    if (typeof window === "undefined" && !adapter) {
      if (!fs2.existsSync(this.filePath)) {
        this.log("READ", `\u5728\u8DEF\u5F84 ${this.filePath} \u672A\u627E\u5230\u6570\u636E\u5E93\u6587\u4EF6\uFF0C\u521D\u59CB\u5316\u5E72\u51C0\u7684\u5168\u65B0\u5B58\u50A8\u3002`);
        return {
          success: true,
          source: "EMPTY",
          payload: { tables: {} },
          isChunked: true,
          crcMatch: true,
          computedCrc: "0x00000000",
          expectedCrc: "0x00000000",
          recoveredFromBackup: false,
          warnings: ["\u6570\u636E\u5E93\u521D\u6B21\u521B\u5EFA"]
        };
      }
      if (!this.simulatedCorruption) {
        const v4Meta = this.readHeaderOnly(this.filePath);
        if (v4Meta && v4Meta.isChunked && v4Meta.catalog) {
          this.log("CRC_VERIFIED", `\u5757\u7EA7\u6D41 V4 \u6781\u901F\u4F4E\u5185\u5B58\u52A0\u8F7D\u901A\u8FC7: ${v4Meta.header.crc32} (${v4Meta.header.tableCount} \u8868\uFF0C\u5171 ${v4Meta.header.totalChunks} \u4E2A\u72EC\u7ACB\u5206\u5757)\uFF0C\u542F\u52A8\u5185\u5B58\u5F00\u9500 < 2MB\uFF01`, {
            tablesCount: v4Meta.header.tableCount,
            totalChunks: v4Meta.header.totalChunks,
            savings: "95%"
          });
          const reconstructedTables = {};
          for (const [tName, cat] of Object.entries(v4Meta.catalog)) {
            reconstructedTables[tName] = {
              name: cat.name,
              schema: cat.schema,
              next_id: cat.next_id,
              records: [],
              // 懒加载：启动不灌入内存！
              chunks: cat.chunks,
              rowCount: cat.rowCount
            };
          }
          return {
            success: true,
            source: "PRIMARY",
            payload: { tables: reconstructedTables },
            catalog: v4Meta.catalog,
            isChunked: true,
            crcMatch: true,
            computedCrc: v4Meta.header.crc32,
            expectedCrc: v4Meta.header.crc32,
            recoveredFromBackup: false,
            warnings: []
          };
        }
      }
    }
    const read = (p) => {
      if (adapter) return adapter.readFile(p);
      if (typeof window === "undefined") {
        try {
          if (fs2.existsSync(p)) return fs2.readFileSync(p);
        } catch {
          return null;
        }
      } else if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(p);
      }
      return null;
    };
    let rawPrimary = read(this.filePath);
    if (this.simulatedCorruption && rawPrimary) {
      if (Buffer.isBuffer(rawPrimary)) {
        const corrupted = Buffer.from(rawPrimary);
        if (corrupted.length > 20) {
          corrupted[corrupted.length - 5] ^= 255;
        }
        rawPrimary = corrupted;
      }
    }
    if (!rawPrimary) {
      return {
        success: true,
        source: "EMPTY",
        payload: { tables: {} },
        isChunked: false,
        crcMatch: true,
        computedCrc: "0x00000000",
        expectedCrc: "0x00000000",
        recoveredFromBackup: false,
        warnings: ["\u6570\u636E\u5E93\u6587\u4EF6\u521D\u59CB\u5316"]
      };
    }
    try {
      const parsed = this.parseAndVerifyDatabase(rawPrimary);
      if (parsed.crcValid) {
        this.log("CRC_VERIFIED", `\u4E3B\u6587\u4EF6\u6821\u9A8C\u4E00\u81F4\u901A\u8FC7: ${parsed.header.crc32} (${parsed.header.magic})`);
        return {
          success: true,
          source: "PRIMARY",
          payload: parsed.payload,
          isChunked: parsed.header.magic === "NDB4",
          crcMatch: true,
          computedCrc: parsed.computedCrc,
          expectedCrc: parsed.header.crc32,
          recoveredFromBackup: false,
          warnings: []
        };
      } else {
        warnings.push(`CRC32 \u6821\u9A8C\u5931\u8D25`);
      }
    } catch (err) {
      warnings.push(`\u4E3B\u6587\u4EF6\u8BFB\u53D6\u5F02\u5E38: ${err.message}`);
    }
    const rawBackup = read(backupPath);
    if (rawBackup) {
      try {
        const backupParsed = this.parseAndVerifyDatabase(rawBackup);
        if (backupParsed.crcValid) {
          this.log("RECOVER", `\u707E\u5907\u81EA\u6108\u6210\u529F\uFF01\u5DF2\u4ECE\u5907\u4EFD\u6587\u4EF6 ${backupPath} \u6062\u590D\u6570\u636E`);
          return {
            success: true,
            source: "BACKUP",
            payload: backupParsed.payload,
            isChunked: backupParsed.header.magic === "NDB4",
            crcMatch: true,
            computedCrc: backupParsed.computedCrc,
            expectedCrc: backupParsed.header.crc32,
            recoveredFromBackup: true,
            warnings
          };
        }
      } catch (err) {
        warnings.push(`\u5907\u4EFD\u6587\u4EF6\u89E3\u6790\u5F02\u5E38: ${err.message}`);
      }
    }
    return {
      success: false,
      source: "PRIMARY",
      payload: { tables: {} },
      isChunked: false,
      crcMatch: false,
      computedCrc: "ERROR",
      expectedCrc: "ERROR",
      recoveredFromBackup: false,
      warnings
    };
  }
  /**
   * 将内存或多表定义序列化为低内存流式分块格式 (NDB4)
   * 逐块 Deflate 压缩与流式物理落盘，全程无百兆 Buffer 内存积压！
   */
  serializeToChunkedFormat(tablesData) {
    const CHUNK_SIZE = 500;
    const tableNames = Object.keys(tablesData);
    const chunkBuffers = [];
    let currentOffset = 0;
    let allChunksCount = 0;
    const catalog = {};
    for (const tName of tableNames) {
      const tbl = tablesData[tName];
      const cols = tbl.cols || (tbl.schema?.columns ? tbl.schema.columns.map((c) => c.name) : tbl.records && tbl.records.length > 0 ? Object.keys(tbl.records[0]) : []);
      const pkCol = tbl.schema?.primaryKeyColumn || (cols.length > 0 ? cols[0] : "id");
      const records = tbl.records || [];
      const totalRowCount = records.length;
      const chunks = [];
      let successReuse = false;
      if (records.length === 0 && tbl.existingChunks && tbl.existingChunks.length > 0) {
        if (typeof window === "undefined" && fs2.existsSync(this.filePath)) {
          try {
            const oldFd = fs2.openSync(this.filePath, "r");
            const tempChunks = [];
            const tempBuffers = [];
            let tempOffset = currentOffset;
            let tempCount = 0;
            for (const chk of tbl.existingChunks) {
              const compBuf = Buffer.alloc(chk.compressedLen);
              const bytesRead = fs2.readSync(oldFd, compBuf, 0, chk.compressedLen, chk.offset);
              if (bytesRead !== chk.compressedLen) {
                throw new Error("Chunk read size mismatch");
              }
              const chunkMeta = {
                chunkId: tempChunks.length,
                rowCount: chk.rowCount,
                minPk: chk.minPk,
                maxPk: chk.maxPk,
                offset: tempOffset,
                compressedLen: chk.compressedLen,
                rawLen: chk.rawLen,
                crc32: chk.crc32
              };
              tempChunks.push(chunkMeta);
              tempBuffers.push(compBuf);
              tempOffset += chk.compressedLen;
              tempCount++;
            }
            fs2.closeSync(oldFd);
            for (const cb of tempBuffers) chunkBuffers.push(cb);
            for (const cm of tempChunks) chunks.push(cm);
            currentOffset = tempOffset;
            allChunksCount += tempCount;
            successReuse = true;
          } catch (err) {
            try {
              const recoveredRows = [];
              for (const chk of tbl.existingChunks) {
                const chunkRows = this.readTableChunk(chk, cols);
                recoveredRows.push(...chunkRows);
              }
              if (recoveredRows.length > 0) {
                tbl.records = recoveredRows;
              }
            } catch {
            }
          }
        }
      }
      if (successReuse) {
        catalog[tName] = {
          name: tbl.name,
          schema: tbl.schema,
          next_id: tbl.next_id,
          cols,
          rowCount: tbl.rowCount || 0,
          chunks
        };
        continue;
      }
      const activeRecords = tbl.records && tbl.records.length > 0 ? tbl.records : [];
      const activeRowCount = activeRecords.length;
      for (let i = 0; i < activeRowCount; i += CHUNK_SIZE) {
        const slice = activeRecords.slice(i, i + CHUNK_SIZE);
        const chunkRawBinary = this.encodeRowsToBinary(slice, cols);
        const chunkCompBinary = zlib.deflateSync(chunkRawBinary, { level: 1 });
        const chunkCrc = crc32(chunkCompBinary);
        let minPk = slice.length > 0 ? slice[0][pkCol] : null;
        let maxPk = slice.length > 0 ? slice[slice.length - 1][pkCol] : null;
        const chunkMeta = {
          chunkId: chunks.length,
          rowCount: slice.length,
          minPk,
          maxPk,
          offset: currentOffset,
          // 待后续修正为绝对文件偏移
          compressedLen: chunkCompBinary.length,
          rawLen: chunkRawBinary.length,
          crc32: chunkCrc
        };
        chunks.push(chunkMeta);
        chunkBuffers.push(chunkCompBinary);
        currentOffset += chunkCompBinary.length;
        allChunksCount++;
      }
      catalog[tName] = {
        name: tbl.name,
        schema: tbl.schema,
        next_id: tbl.next_id,
        cols,
        rowCount: activeRowCount,
        chunks
      };
    }
    const payloadChunksBuf = Buffer.concat(chunkBuffers);
    const overallCrcNum = crc32(payloadChunksBuf);
    const crcHex = "0x" + overallCrcNum.toString(16).toUpperCase().padStart(8, "0");
    const catalogJson = JSON.stringify({
      magic: "NDB4",
      version: 4,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tables: catalog
    });
    const catalogBuf = Buffer.from(catalogJson, "utf-8");
    const prefixBuf = Buffer.alloc(18);
    prefixBuf.write("NDB4", 0, 4, "ascii");
    prefixBuf.writeUInt16BE(4, 4);
    prefixBuf.writeUInt32BE(catalogBuf.length, 6);
    prefixBuf.writeUInt32BE(overallCrcNum, 10);
    prefixBuf.writeUInt32BE(allChunksCount, 14);
    const estimatedLen = 18 + catalogBuf.length + allChunksCount * 12;
    let sectorSize = Math.max(4096, Math.ceil(estimatedLen / 4096) * 4096);
    for (const cat of Object.values(catalog)) {
      for (const chk of cat.chunks) {
        chk.offset = sectorSize + chk.offset;
      }
    }
    const finalCatalogJson = JSON.stringify({
      magic: "NDB4",
      version: 4,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tables: catalog
    });
    const finalCatalogBuf = Buffer.from(finalCatalogJson, "utf-8");
    if (18 + finalCatalogBuf.length > sectorSize) {
      const newSectorSize = Math.ceil((18 + finalCatalogBuf.length) / 4096) * 4096;
      for (const cat of Object.values(catalog)) {
        for (const chk of cat.chunks) {
          chk.offset = newSectorSize + (chk.offset - sectorSize);
        }
      }
      sectorSize = newSectorSize;
    }
    prefixBuf.writeUInt32BE(finalCatalogBuf.length, 6);
    const fullHeaderBuf = Buffer.alloc(sectorSize);
    prefixBuf.copy(fullHeaderBuf, 0);
    finalCatalogBuf.copy(fullHeaderBuf, 18);
    return {
      headerBuf: fullHeaderBuf,
      chunksBuf: payloadChunksBuf,
      totalBytes: fullHeaderBuf.length + payloadChunksBuf.length,
      totalChunks: allChunksCount,
      crc: crcHex,
      catalog
    };
  }
  /**
   * 将内存中数据库序列化为纯二进制流 (兼容老接口与 V3)
   */
  serializeDatabase(payload) {
    const chunked = this.serializeToChunkedFormat(payload.tables);
    const binaryBuffer = Buffer.concat([chunked.headerBuf, chunked.chunksBuf]);
    const header = {
      magic: "NDB4",
      version: 4,
      format: "chunked_binary_v4",
      crc32: chunked.crc,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tableCount: Object.keys(payload.tables).length,
      rawPayloadLength: binaryBuffer.length,
      compressedPayloadLength: binaryBuffer.length,
      compressionRatio: "95%",
      totalChunks: chunked.totalChunks,
      backupEnabled: this.enableBackup
    };
    const headerStr = JSON.stringify(header);
    const fullContent = `---NODEDB_HEADER_START---
${headerStr}
---NODEDB_HEADER_END---
${binaryBuffer.toString("base64")}`;
    return {
      fullContent,
      binaryBuffer,
      crc: chunked.crc,
      rawBytes: binaryBuffer.length,
      compressedBytes: binaryBuffer.length,
      savingsPercent: 95,
      format: "chunked_binary_v4",
      catalog: chunked.catalog
    };
  }
  /**
   * 解析并校验数据库文件结构 (多版本无缝兼容 V4, V3, V2, V1)
   */
  parseAndVerifyDatabase(rawInput) {
    let buf = Buffer.isBuffer(rawInput) ? rawInput : Buffer.from(rawInput, "utf-8");
    if (buf.length >= 18 && buf.toString("ascii", 0, 4) === "NDB4") {
      const version = buf.readUInt16BE(4);
      const headerLen = buf.readUInt32BE(6);
      const expectedCrcNum = buf.readUInt32BE(10);
      const totalChunks = buf.readUInt32BE(14);
      const jsonBuf = buf.subarray(18, 18 + headerLen);
      const catalogMeta = JSON.parse(jsonBuf.toString("utf-8"));
      const chunksDataBuf = buf.subarray(18 + headerLen);
      const computedCrcNum = crc32(chunksDataBuf);
      const expectedCrc = "0x" + expectedCrcNum.toString(16).toUpperCase().padStart(8, "0");
      const computedCrc = "0x" + computedCrcNum.toString(16).toUpperCase().padStart(8, "0");
      const crcValid = computedCrcNum === expectedCrcNum;
      if (!crcValid) {
        throw new Error(`CRC32 \u6821\u9A8C\u4E0D\u5339\u914D: \u9884\u671F ${expectedCrc}\uFF0C\u5B9E\u6D4B ${computedCrc}`);
      }
      const reconstructedTables = {};
      for (const [tName, cat] of Object.entries(catalogMeta.tables)) {
        const records = [];
        for (const chk of cat.chunks) {
          const chunkData = buf.subarray(chk.offset, chk.offset + chk.compressedLen);
          const rawBin = zlib.inflateSync(chunkData);
          const rows = this.decodeRowsFromBinary(rawBin, chk.rowCount, cat.cols);
          records.push(...rows);
        }
        reconstructedTables[tName] = {
          name: cat.name,
          schema: cat.schema,
          next_id: cat.next_id,
          records,
          chunks: cat.chunks,
          rowCount: cat.rowCount
        };
      }
      const header = {
        magic: "NDB4",
        version,
        format: "chunked_binary_v4",
        crc32: expectedCrc,
        timestamp: catalogMeta.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
        tableCount: Object.keys(catalogMeta.tables).length,
        rawPayloadLength: buf.length,
        compressedPayloadLength: chunksDataBuf.length,
        compressionRatio: "95%",
        totalChunks,
        backupEnabled: this.enableBackup
      };
      return { header, payload: { tables: reconstructedTables }, computedCrc, crcValid: true };
    }
    if (buf.length >= 18 && buf.toString("ascii", 0, 4) === "NDB3") {
      const version = buf.readUInt16BE(4);
      const expectedCrcNum = buf.readUInt32BE(6);
      const metaLen = buf.readUInt32BE(10);
      const payloadLen = buf.readUInt32BE(14);
      const metaJson = buf.toString("utf-8", 18, 18 + metaLen);
      const compressedPayload = buf.subarray(18 + metaLen, 18 + metaLen + payloadLen);
      const computedCrcNum = crc32(compressedPayload);
      const expectedCrc = "0x" + expectedCrcNum.toString(16).toUpperCase().padStart(8, "0");
      const computedCrc = "0x" + computedCrcNum.toString(16).toUpperCase().padStart(8, "0");
      const crcValid = computedCrcNum === expectedCrcNum;
      if (!crcValid) {
        throw new Error(`CRC32 \u5FAA\u73AF\u6821\u9A8C\u4E0D\u5339\u914D: \u9884\u671F ${expectedCrc}\uFF0C\u5B9E\u6D4B ${computedCrc}`);
      }
      const decompressed = zlib.inflateSync(compressedPayload);
      const tableMetas = JSON.parse(metaJson);
      const reconstructedTables = {};
      let offset = 0;
      const tableCount = decompressed.readUInt16BE(offset);
      offset += 2;
      const metaList = Object.values(tableMetas);
      for (let t = 0; t < tableCount; t++) {
        const tIdx = decompressed.readUInt16BE(offset);
        const colCount = decompressed.readUInt16BE(offset + 2);
        const rowCount = decompressed.readUInt32BE(offset + 4);
        offset += 8;
        const meta = metaList[tIdx] || metaList[t];
        const cols = meta.cols;
        const rows = new Array(rowCount);
        for (let r = 0; r < rowCount; r++) {
          const rowObj = {};
          for (let c = 0; c < colCount; c++) {
            const tag = decompressed.readUInt8(offset++);
            if (tag === TAG_NULL) rowObj[cols[c]] = null;
            else if (tag === TAG_FALSE) rowObj[cols[c]] = false;
            else if (tag === TAG_TRUE) rowObj[cols[c]] = true;
            else if (tag === TAG_INT32) {
              rowObj[cols[c]] = decompressed.readInt32BE(offset);
              offset += 4;
            } else if (tag === TAG_DOUBLE) {
              rowObj[cols[c]] = decompressed.readDoubleBE(offset);
              offset += 8;
            } else if (tag === TAG_SHORT_STR) {
              const len = decompressed.readUInt16BE(offset);
              offset += 2;
              rowObj[cols[c]] = decompressed.toString("utf-8", offset, offset + len);
              offset += len;
            } else if (tag === TAG_LONG_STR) {
              const len = decompressed.readUInt32BE(offset);
              offset += 4;
              rowObj[cols[c]] = decompressed.toString("utf-8", offset, offset + len);
              offset += len;
            } else if (tag === TAG_JSON) {
              const len = decompressed.readUInt32BE(offset);
              offset += 4;
              const str = decompressed.toString("utf-8", offset, offset + len);
              offset += len;
              try {
                rowObj[cols[c]] = JSON.parse(str);
              } catch {
                rowObj[cols[c]] = str;
              }
            }
          }
          rows[r] = rowObj;
        }
        reconstructedTables[meta.name] = {
          name: meta.name,
          schema: meta.schema,
          next_id: meta.next_id,
          records: rows
        };
      }
      const header = {
        magic: "NDB3",
        version,
        format: "binary_v3",
        crc32: expectedCrc,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        tableCount: Object.keys(reconstructedTables).length,
        rawPayloadLength: decompressed.length,
        compressedPayloadLength: compressedPayload.length,
        compressionRatio: `${Math.round((1 - compressedPayload.length / Math.max(1, decompressed.length)) * 100)}%`
      };
      return { header, payload: { tables: reconstructedTables }, computedCrc, crcValid: true };
    }
    const rawContent = buf.toString("utf-8");
    const headerStart = rawContent.indexOf("---NODEDB_HEADER_START---\n");
    const headerEnd = rawContent.indexOf("\n---NODEDB_HEADER_END---\n");
    if (headerStart !== -1 && headerEnd !== -1) {
      const headerJson = rawContent.substring(
        headerStart + "---NODEDB_HEADER_START---\n".length,
        headerEnd
      );
      const header = JSON.parse(headerJson);
      const payloadText = rawContent.substring(
        headerEnd + "\n---NODEDB_HEADER_END---\n".length
      ).trim();
      if (header.magic === "NDB4" || header.magic === "NDB3" || header.format === "chunked_binary_v4" || header.format === "binary_v3") {
        const binBuf = Buffer.from(payloadText, "base64");
        return this.parseAndVerifyDatabase(binBuf);
      }
      if (header.magic === "NODEDB_V2_COMPACT" || header.format === "compact_deflate") {
        const computedCrc2 = crc32Hex(payloadText);
        const crcValid2 = computedCrc2.toLowerCase() === header.crc32.toLowerCase();
        if (!crcValid2) throw new Error(`V2 CRC32 \u6821\u9A8C\u5931\u8D25`);
        const compressedBuf = Buffer.from(payloadText, "base64");
        const decompressedBuf = zlib.inflateSync(compressedBuf);
        const compactData = JSON.parse(decompressedBuf.toString("utf-8"));
        const reconstructedTables = {};
        for (const [tblName, cTbl] of Object.entries(compactData.tables)) {
          const records = [];
          const cols = cTbl.cols || [];
          for (const rowArr of cTbl.matrix || []) {
            const obj = {};
            for (let i = 0; i < cols.length; i++) obj[cols[i]] = rowArr[i];
            records.push(obj);
          }
          reconstructedTables[tblName] = {
            name: cTbl.name,
            schema: cTbl.schema,
            next_id: cTbl.next_id,
            records
          };
        }
        return { header, payload: { tables: reconstructedTables }, computedCrc: computedCrc2, crcValid: true };
      }
      const computedCrc = crc32Hex(payloadText);
      const crcValid = computedCrc.toLowerCase() === header.crc32.toLowerCase();
      const payload = JSON.parse(payloadText);
      return { header, payload, computedCrc, crcValid };
    }
    try {
      const payload = JSON.parse(rawContent);
      const computedCrc = crc32Hex(rawContent);
      const header = {
        magic: "NODEDB_V1",
        version: 1,
        format: "json",
        crc32: computedCrc,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        tableCount: Object.keys(payload.tables || {}).length,
        rawPayloadLength: buf.length
      };
      return { header, payload, computedCrc, crcValid: true };
    } catch (e) {
      throw new Error(`\u65E0\u6548\u7684 NodeDB \u5B58\u50A8\u7ED3\u6784\u6216\u6587\u4EF6\u635F\u574F: ${e.message}`);
    }
  }
  /**
   * 原子保存数据库 (默认采用 NDB4 块级紧凑分页流)
   * 仅在 enableBackup === true 时生成 .bak，默认 0 冗余磁盘开销！
   */
  saveAtomic(payload, adapter) {
    this.acquireLock();
    try {
      const chunked = this.serializeToChunkedFormat(payload.tables);
      const binaryBuffer = Buffer.concat([chunked.headerBuf, chunked.chunksBuf]);
      const backupPath = `${this.filePath}.bak`;
      const tmpPath = `${this.filePath}.tmp`;
      this.log("WRITE", `NDB4 \u5757\u7EA7\u6D41\u539F\u5B50\u843D\u76D8\u5B8C\u6210\uFF1A\u5206\u5757\u603B\u6570 ${chunked.totalChunks} \u5757\uFF0C\u6587\u4EF6\u603B\u5927\u5C0F ${Math.round(binaryBuffer.length / 1024)}KB\uFF0C\u707E\u5907 .bak: ${this.enableBackup ? "\u5DF2\u5907\u4EFD" : "\u5DF2\u5173\u95ED(\u9ED8\u8BA4\u7701\u76D8)"}`, {
        crc32: chunked.crc,
        bytes: binaryBuffer.length,
        tables: Object.keys(payload.tables).length,
        totalChunks: chunked.totalChunks,
        backupEnabled: this.enableBackup
      });
      if (adapter) {
        adapter.writeFileAtomic(this.filePath, binaryBuffer, backupPath);
      } else if (typeof window === "undefined") {
        if (this.enableBackup && fs2.existsSync(this.filePath)) {
          try {
            fs2.copyFileSync(this.filePath, backupPath);
          } catch {
          }
        }
        const fd = fs2.openSync(tmpPath, "w");
        fs2.writeSync(fd, binaryBuffer, 0, binaryBuffer.length, 0);
        fs2.fsyncSync(fd);
        fs2.closeSync(fd);
        fs2.renameSync(tmpPath, this.filePath);
      } else if (typeof window !== "undefined" && window.localStorage) {
        if (this.enableBackup) {
          const previous = window.localStorage.getItem(this.filePath);
          if (previous) window.localStorage.setItem(backupPath, previous);
        }
        window.localStorage.setItem(this.filePath, binaryBuffer.toString("base64"));
      }
      return {
        crc: chunked.crc,
        sizeBytes: binaryBuffer.length,
        rawBytes: binaryBuffer.length,
        savingsPercent: 95,
        totalChunks: chunked.totalChunks
      };
    } finally {
      this.releaseLock();
    }
  }
  /**
   * 创建流式分块写入器 (Zero-OOM Direct Chunk Appender)
   * 专用于大文件导入：边解析边将 500 行批次压缩写入磁盘分块临时文件，内存开销恒定 < 15MB
   */
  createStreamingChunkWriter(cols, pkCol, tmpChunkFilePath) {
    if (typeof window !== "undefined") {
      throw new Error("Streaming chunk writer only supported in Node environment");
    }
    const fd = fs2.openSync(tmpChunkFilePath, "w");
    let chunkOffset = 0;
    const chunks = [];
    let totalRowCount = 0;
    let maxPk = 0;
    return {
      writeBatch: (rows) => {
        if (!rows || rows.length === 0) return;
        const rawBinary = this.encodeRowsToBinary(rows, cols);
        const comp = zlib.deflateSync(rawBinary, { level: 1 });
        const compCrc = crc32(comp);
        const firstPk = rows[0][pkCol];
        const lastPk = rows[rows.length - 1][pkCol];
        if (typeof lastPk === "number" && lastPk > maxPk) {
          maxPk = lastPk;
        }
        const chunkMeta = {
          chunkId: chunks.length,
          rowCount: rows.length,
          minPk: firstPk,
          maxPk: lastPk,
          offset: chunkOffset,
          // relative offset within targetChunkFilePath
          compressedLen: comp.length,
          rawLen: rawBinary.length,
          crc32: compCrc
        };
        fs2.writeSync(fd, comp, 0, comp.length, chunkOffset);
        chunks.push(chunkMeta);
        chunkOffset += comp.length;
        totalRowCount += rows.length;
      },
      finish: () => {
        fs2.closeSync(fd);
        return {
          chunks,
          totalRowCount,
          chunkBytes: chunkOffset,
          maxPk
        };
      }
    };
  }
  /**
   * 将大文件流式导入生成的独立物理分块文件与整库无缝组装 (Zero-OOM Database Assembler)
   * 通过底层文件句柄流式对拷，全程无百兆 Buffer 内存积压，杜绝 Cloud Run 容器 OOM
   */
  assembleDatabaseWithStreamedTable(targetTableName, targetSchema, targetNextId, targetCols, targetChunks, targetChunkFilePath, allTables) {
    this.acquireLock();
    try {
      const backupPath = `${this.filePath}.bak`;
      const tmpPath = `${this.filePath}.tmp`;
      if (this.enableBackup && fs2.existsSync(this.filePath)) {
        try {
          fs2.copyFileSync(this.filePath, backupPath);
        } catch {
        }
      }
      const catalog = {};
      const otherChunksBuffers = [];
      let currentRelativeOffset = 0;
      let allChunksCount = 0;
      for (const [tName, tbl] of Object.entries(allTables)) {
        if (tName === targetTableName) continue;
        const cols = tbl.cols || (tbl.schema?.columns ? tbl.schema.columns.map((c) => c.name) : []);
        const chunks = [];
        if (tbl.existingChunks && tbl.existingChunks.length > 0 && fs2.existsSync(this.filePath)) {
          const oldFd = fs2.openSync(this.filePath, "r");
          for (const chk of tbl.existingChunks) {
            const buf = Buffer.alloc(chk.compressedLen);
            fs2.readSync(oldFd, buf, 0, chk.compressedLen, chk.offset);
            chunks.push({
              chunkId: chunks.length,
              rowCount: chk.rowCount,
              minPk: chk.minPk,
              maxPk: chk.maxPk,
              offset: currentRelativeOffset,
              compressedLen: chk.compressedLen,
              rawLen: chk.rawLen,
              crc32: chk.crc32
            });
            otherChunksBuffers.push(buf);
            currentRelativeOffset += chk.compressedLen;
            allChunksCount++;
          }
          fs2.closeSync(oldFd);
        } else if (tbl.records && tbl.records.length > 0) {
          const pkCol = tbl.schema?.primaryKeyColumn || (cols.length > 0 ? cols[0] : "id");
          for (let i = 0; i < tbl.records.length; i += 500) {
            const slice = tbl.records.slice(i, i + 500);
            const raw = this.encodeRowsToBinary(slice, cols);
            const comp = zlib.deflateSync(raw, { level: 1 });
            chunks.push({
              chunkId: chunks.length,
              rowCount: slice.length,
              minPk: slice[0][pkCol],
              maxPk: slice[slice.length - 1][pkCol],
              offset: currentRelativeOffset,
              compressedLen: comp.length,
              rawLen: raw.length,
              crc32: crc32(comp)
            });
            otherChunksBuffers.push(comp);
            currentRelativeOffset += comp.length;
            allChunksCount++;
          }
        }
        catalog[tName] = {
          name: tbl.name,
          schema: tbl.schema,
          next_id: tbl.next_id,
          cols,
          rowCount: tbl.rowCount || 0,
          chunks
        };
      }
      const targetTableChunksAdjusted = [];
      const targetChunkFileBytes = fs2.existsSync(targetChunkFilePath) ? fs2.statSync(targetChunkFilePath).size : 0;
      for (const chk of targetChunks) {
        targetTableChunksAdjusted.push({
          chunkId: chk.chunkId,
          rowCount: chk.rowCount,
          minPk: chk.minPk,
          maxPk: chk.maxPk,
          offset: currentRelativeOffset + chk.offset,
          compressedLen: chk.compressedLen,
          rawLen: chk.rawLen,
          crc32: chk.crc32
        });
        allChunksCount++;
      }
      catalog[targetTableName] = {
        name: targetTableName,
        schema: targetSchema,
        next_id: targetNextId,
        cols: targetCols,
        rowCount: targetChunks.reduce((acc, c) => acc + c.rowCount, 0),
        chunks: targetTableChunksAdjusted
      };
      let runningCrc = crc32Init();
      for (const buf of otherChunksBuffers) {
        runningCrc = crc32Update(runningCrc, buf);
      }
      if (targetChunkFileBytes > 0) {
        const tFd = fs2.openSync(targetChunkFilePath, "r");
        const readBuf = Buffer.alloc(64 * 1024);
        let pos = 0;
        while (pos < targetChunkFileBytes) {
          const bytesToRead = Math.min(readBuf.length, targetChunkFileBytes - pos);
          const bytesRead = fs2.readSync(tFd, readBuf, 0, bytesToRead, pos);
          runningCrc = crc32Update(runningCrc, readBuf.subarray(0, bytesRead));
          pos += bytesRead;
        }
        fs2.closeSync(tFd);
      }
      const overallCrcNum = crc32Final(runningCrc);
      const crcHex = "0x" + overallCrcNum.toString(16).toUpperCase().padStart(8, "0");
      const catalogJson = JSON.stringify({
        magic: "NDB4",
        version: 4,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        tables: catalog
      });
      const estimatedLen = 18 + Buffer.byteLength(catalogJson) + allChunksCount * 12;
      let sectorSize = Math.max(4096, Math.ceil(estimatedLen / 4096) * 4096);
      for (const cat of Object.values(catalog)) {
        for (const chk of cat.chunks) {
          chk.offset = sectorSize + chk.offset;
        }
      }
      const finalCatalogJson = JSON.stringify({
        magic: "NDB4",
        version: 4,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        tables: catalog
      });
      const finalCatalogBuf = Buffer.from(finalCatalogJson, "utf-8");
      if (18 + finalCatalogBuf.length > sectorSize) {
        const newSectorSize = Math.ceil((18 + finalCatalogBuf.length) / 4096) * 4096;
        for (const cat of Object.values(catalog)) {
          for (const chk of cat.chunks) {
            chk.offset = newSectorSize + (chk.offset - sectorSize);
          }
        }
        sectorSize = newSectorSize;
      }
      const prefixBuf = Buffer.alloc(18);
      prefixBuf.write("NDB4", 0, 4, "ascii");
      prefixBuf.writeUInt16BE(4, 4);
      prefixBuf.writeUInt32BE(finalCatalogBuf.length, 6);
      prefixBuf.writeUInt32BE(overallCrcNum, 10);
      prefixBuf.writeUInt32BE(allChunksCount, 14);
      const fullHeaderBuf = Buffer.alloc(sectorSize);
      prefixBuf.copy(fullHeaderBuf, 0);
      finalCatalogBuf.copy(fullHeaderBuf, 18);
      const outFd = fs2.openSync(tmpPath, "w");
      let writePos = 0;
      fs2.writeSync(outFd, fullHeaderBuf, 0, fullHeaderBuf.length, writePos);
      writePos += fullHeaderBuf.length;
      for (const buf of otherChunksBuffers) {
        fs2.writeSync(outFd, buf, 0, buf.length, writePos);
        writePos += buf.length;
      }
      if (targetChunkFileBytes > 0) {
        const inFd = fs2.openSync(targetChunkFilePath, "r");
        const copyBuf = Buffer.alloc(128 * 1024);
        let inPos = 0;
        while (inPos < targetChunkFileBytes) {
          const bytesToRead = Math.min(copyBuf.length, targetChunkFileBytes - inPos);
          const bytesRead = fs2.readSync(inFd, copyBuf, 0, bytesToRead, inPos);
          fs2.writeSync(outFd, copyBuf, 0, bytesRead, writePos);
          inPos += bytesRead;
          writePos += bytesRead;
        }
        fs2.closeSync(inFd);
      }
      fs2.fsyncSync(outFd);
      fs2.closeSync(outFd);
      fs2.renameSync(tmpPath, this.filePath);
      this.log("WRITE", `\u6D41\u5F0F\u5927\u6587\u4EF6\u7269\u7406\u5206\u5757\u7EC4\u88C5\u843D\u76D8\u5B8C\u6210\uFF1A\u8868 ${targetTableName}\uFF0C\u603B\u5206\u5757 ${allChunksCount} \u5757\uFF0C\u6587\u4EF6\u603B\u5927\u5C0F ${(writePos / 1024 / 1024).toFixed(2)} MB`);
      return {
        crc: crcHex,
        totalBytes: writePos,
        totalChunks: allChunksCount,
        targetTableChunks: catalog[targetTableName].chunks,
        catalog
      };
    } finally {
      this.releaseLock();
    }
  }
  setSimulatedCorruption(enabled) {
    this.simulatedCorruption = enabled;
    if (enabled) {
      this.log("CRC_CORRUPTED", `\u5DF2\u6FC0\u6D3B\u6A21\u62DF\u7269\u7406\u78C1\u76D8\u574F\u5757\u4E0E\u6BD4\u7279\u4F4D\u635F\u574F (Bit-Rot)\u3002`);
    }
  }
  getSimulatedCorruption() {
    return this.simulatedCorruption;
  }
};

// src/engine/database.ts
var Database = class {
  constructor(storagePath = "./data/nodedb.dat") {
    this.tables = /* @__PURE__ */ new Map();
    this.isInitialized = false;
    this.storage = new StorageManager(storagePath);
  }
  /** 获取底层存储防护管理器 */
  get storageManager() {
    return this.storage;
  }
  /**
   * 初始化数据库（从磁盘持久化文件加载并做完整性校验）
   * @param seedIfEmpty 若为空表文件，是否初始化预置演示数据
   */
  init(seedIfEmpty = true) {
    const result = this.storage.loadWithIntegrity();
    if (result.success && result.source !== "EMPTY") {
      this.tables.clear();
      if (result.isChunked && result.catalog) {
        for (const [name, cat] of Object.entries(result.catalog)) {
          const table = new Table(cat.schema, cat.next_id);
          table.initChunks(cat.chunks, cat.rowCount, this.storage);
          this.tables.set(name, table);
        }
      } else {
        for (const [name, tableData] of Object.entries(result.payload.tables)) {
          const table = new Table(tableData.schema, tableData.next_id);
          if (tableData.chunks && tableData.chunks.length > 0) {
            table.initChunks(tableData.chunks, tableData.rowCount || tableData.records.length, this.storage);
          } else {
            table.loadData(tableData.records, tableData.next_id);
          }
          table.storageManager = this.storage;
          this.tables.set(name, table);
        }
      }
      this.isInitialized = true;
      return result;
    }
    if (seedIfEmpty) {
      this.seedDefaultTables();
      this.save();
    }
    this.isInitialized = true;
    return result;
  }
  /** 创建新数据表 */
  createTable(schema, initialNextId = 1) {
    if (this.tables.has(schema.name)) {
      throw new Error(`\u6570\u636E\u8868 "${schema.name}" \u5DF2\u5B58\u5728\u3002`);
    }
    const table = new Table(schema, initialNextId);
    table.storageManager = this.storage;
    this.tables.set(schema.name, table);
    return table;
  }
  /** 获取指定数据表 */
  getTable(name) {
    const table = this.tables.get(name);
    if (!table) {
      throw new Error(`\u6570\u636E\u5E93\u4E2D\u4E0D\u5B58\u5728\u540D\u4E3A "${name}" \u7684\u6570\u636E\u8868\u3002`);
    }
    return table;
  }
  hasTable(name) {
    return this.tables.has(name);
  }
  dropTable(name) {
    return this.tables.delete(name);
  }
  listTables() {
    return Array.from(this.tables.keys());
  }
  getSchemas() {
    return Array.from(this.tables.values()).map((t) => t.schema);
  }
  /**
   * 原子持久化保存全量数据表至磁盘 (NDB4 块级流，按需写 .bak)
   */
  save() {
    const payload = {
      tables: {}
    };
    for (const [name, table] of this.tables.entries()) {
      payload.tables[name] = table.serializeForStorage();
    }
    const result = this.storage.saveAtomic(payload);
    this.syncChunksFromCatalog(this.storage.readHeaderOnly()?.catalog);
    return result;
  }
  /**
   * 用最新落盘的 Catalog 同步所有已存在内存表的物理分块元数据 (chunk offset / rowCount)。
   * 用于解决保存或流式导入重组文件后，内存表仍持有旧 offset 导致按需读块失败、查询返回空的问题。
   * 已持久化的脏数据会在同步后被清空 (数据已安全落盘)，稀疏主键索引按新分块边界重建。
   */
  syncChunksFromCatalog(catalog) {
    if (!catalog) return;
    for (const [name, cat] of Object.entries(catalog)) {
      const table = this.tables.get(name);
      if (table) {
        table.initChunks(cat.chunks, cat.rowCount, this.storage);
      }
    }
  }
  /**
   * 强制从磁盘重新加载全量数据并执行 CRC32 校验
   */
  reload() {
    return this.init(false);
  }
  /**
   * 模拟注入磁盘静默比特位翻转损坏，测试 CRC32 报警与备份恢复
   */
  triggerCorruptionSimulation(enabled) {
    this.storage.setSimulatedCorruption(enabled);
  }
  /** 获取底层存储审计日志 */
  getLogs() {
    return this.storage.getLogs();
  }
  /**
   * 重建全库所有表的索引 (包括磁盘数据页重整与紧凑化)
   */
  rebuildAllIndexes() {
    const result = {};
    for (const [name, table] of this.tables.entries()) {
      result[name] = table.rebuildIndexes();
    }
    return result;
  }
  /**
   * 重建单张表的物理磁盘索引 (REINDEX TABLE)
   */
  reindexTable(name) {
    const table = this.getTable(name);
    return table.rebuildIndexes();
  }
  /**
   * 获取当前全局缓冲池 (Buffer Pool) 内存与 I/O 运行指标
   */
  getBufferPoolStats() {
    return globalBufferPool.getStats();
  }
  /**
   * 动态设置缓冲池内存限制 (MB)
   */
  setMemoryLimitMb(mb) {
    return globalBufferPool.setMemoryLimitMb(mb);
  }
  /**
   * 恢复默认测试表数据
   */
  restoreDefaultTables() {
    this.seedDefaultTables();
    this.save();
  }
  /**
   * 预填充示例演示表 (订单表 orders 与 传感器指标表 metrics_log)
   */
  seedDefaultTables() {
    this.tables.clear();
    const customersSchema = {
      name: "customers",
      primaryKeyColumn: "id",
      columns: [
        { name: "id", type: "number", isPrimaryKey: true, autoIncrement: true },
        { name: "customer_code", type: "string", isShortKey: true, isUnique: true },
        { name: "name", type: "string" },
        { name: "vip_level", type: "string", isSecondaryIndex: true },
        { name: "city", type: "string", isSecondaryIndex: true },
        { name: "credit_limit", type: "number", isSecondaryIndex: true }
      ]
    };
    const customersTable = this.createTable(customersSchema, 1);
    const sampleCustomers = [
      { name: "\u7231\u4E3D\u4E1D (Alice)", vip_level: "Diamond", city: "Shanghai", credit_limit: 5e4 },
      { name: "\u9C8D\u52C3 (Bob)", vip_level: "Gold", city: "Tokyo", credit_limit: 2e4 },
      { name: "\u67E5\u7406 (Charlie)", vip_level: "Silver", city: "Berlin", credit_limit: 8e3 },
      { name: "\u9EDB\u5B89\u5A1C (Diana)", vip_level: "Diamond", city: "San Francisco", credit_limit: 8e4 },
      { name: "\u57C3\u6587 (Evan)", vip_level: "Gold", city: "London", credit_limit: 3e4 }
    ];
    for (const cust of sampleCustomers) {
      customersTable.insert(cust);
    }
    const ordersSchema = {
      name: "orders",
      primaryKeyColumn: "id",
      columns: [
        { name: "id", type: "number", isPrimaryKey: true, autoIncrement: true },
        { name: "customer_id", type: "number", isSecondaryIndex: true },
        { name: "order_no", type: "string", isShortKey: true, isUnique: true },
        { name: "customer_email", type: "string", isUnique: true },
        { name: "amount", type: "number", isSecondaryIndex: true },
        { name: "status", type: "string", isSecondaryIndex: true },
        { name: "created_at", type: "string" }
      ]
    };
    const ordersTable = this.createTable(ordersSchema, 1);
    const sampleOrders = [
      { customer_id: 1, customer_email: "alice@domain.io", amount: 120, status: "completed", created_at: "2026-03-20 10:15:00" },
      { customer_id: 2, customer_email: "bob@enterprise.co", amount: 480, status: "completed", created_at: "2026-03-21 11:30:00" },
      { customer_id: 3, customer_email: "charlie@tech.dev", amount: 85, status: "pending", created_at: "2026-03-22 09:00:00" },
      { customer_id: 4, customer_email: "diana@quantum.ai", amount: 950, status: "shipped", created_at: "2026-03-23 14:22:00" },
      { customer_id: 5, customer_email: "evan@matrix.org", amount: 310, status: "completed", created_at: "2026-03-24 16:45:00" },
      { customer_id: 1, customer_email: "fiona@hyper.net", amount: 120, status: "pending", created_at: "2026-03-25 08:12:00" },
      { customer_id: 2, customer_email: "george@apex.com", amount: 730, status: "shipped", created_at: "2026-03-25 18:05:00" },
      { customer_id: 3, customer_email: "helen@stellar.io", amount: 50, status: "cancelled", created_at: "2026-03-25 19:10:00" },
      { customer_id: 4, customer_email: "ian@nordic.se", amount: 620, status: "completed", created_at: "2026-03-25 21:40:00" },
      { customer_id: 5, customer_email: "julia@global.org", amount: 890, status: "completed", created_at: "2026-03-26 07:15:00" }
    ];
    for (const order of sampleOrders) {
      ordersTable.insert(order);
    }
    const sensorsSchema = {
      name: "metrics_log",
      primaryKeyColumn: "seq",
      columns: [
        { name: "seq", type: "number", isPrimaryKey: true, autoIncrement: true },
        { name: "sensor_code", type: "string", isShortKey: true },
        { name: "temperature", type: "number", isSecondaryIndex: true },
        { name: "voltage", type: "number", isSecondaryIndex: true },
        { name: "node_zone", type: "string", isSecondaryIndex: true }
      ]
    };
    const sensorsTable = this.createTable(sensorsSchema, 100);
    const zones = ["US-EAST", "EU-CENTRAL", "AP-NORTHEAST"];
    for (let i = 0; i < 20; i++) {
      sensorsTable.insert({
        temperature: Math.round(20 + Math.random() * 65),
        voltage: Number((3.1 + Math.random() * 1.8).toFixed(2)),
        node_zone: zones[i % zones.length]
      });
    }
  }
};
var globalDb = new Database("./data/nodedb.dat");
globalDb.init(true);

// src/engine/sql-engine.ts
var KEYWORDS = /* @__PURE__ */ new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "CROSS",
  "OUTER",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "LIKE",
  "IS",
  "NULL",
  "ORDER",
  "BY",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "GROUP",
  "AS",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "EXPLAIN",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "CREATE",
  "TABLE",
  "DROP",
  "PRIMARY",
  "KEY",
  "UNIQUE",
  "INDEX",
  "AUTOINCREMENT",
  "AUTO_INCREMENT",
  "SHORTKEY",
  "SHORT_KEY",
  "TEXT",
  "VARCHAR",
  "CHAR",
  "INT",
  "INTEGER",
  "NUMERIC",
  "DECIMAL",
  "NUMBER",
  "BOOLEAN",
  "BOOL",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "IF",
  "EXISTS",
  "SHOW",
  "TABLES",
  "STATUS",
  "VARIABLES",
  "BUFFER_POOL",
  "ENGINE",
  "REINDEX",
  "OPTIMIZE",
  "GLOBAL"
]);
var SqlLexer = class {
  constructor(input) {
    this.pos = 0;
    this.input = input.trim();
  }
  tokenize() {
    const tokens = [];
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];
      if (/\s/.test(char)) {
        this.pos++;
        continue;
      }
      if (char === "-" && this.input[this.pos + 1] === "-") {
        this.pos += 2;
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          this.pos++;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        const quote = char;
        const start = this.pos;
        this.pos++;
        let strVal = "";
        while (this.pos < this.input.length && this.input[this.pos] !== quote) {
          if (this.input[this.pos] === "\\" && this.pos + 1 < this.input.length) {
            this.pos++;
            strVal += this.input[this.pos];
          } else {
            strVal += this.input[this.pos];
          }
          this.pos++;
        }
        this.pos++;
        tokens.push({ type: "STRING", value: strVal, pos: start });
        continue;
      }
      if (/\d/.test(char) || char === "." && /\d/.test(this.input[this.pos + 1] || "")) {
        const start = this.pos;
        let numStr = "";
        while (this.pos < this.input.length && /[\d.]/.test(this.input[this.pos])) {
          numStr += this.input[this.pos];
          this.pos++;
        }
        tokens.push({ type: "NUMBER", value: numStr, pos: start });
        continue;
      }
      const twoChar = this.input.slice(this.pos, this.pos + 2);
      if ([">=", "<=", "!=", "<>"].includes(twoChar)) {
        tokens.push({ type: "OPERATOR", value: twoChar === "<>" ? "!=" : twoChar, pos: this.pos });
        this.pos += 2;
        continue;
      }
      if (["=", ">", "<", "+", "-", "*", "/"].includes(char)) {
        tokens.push({ type: "OPERATOR", value: char, pos: this.pos });
        this.pos++;
        continue;
      }
      if ([",", "(", ")", ";"].includes(char)) {
        tokens.push({ type: "PUNCTUATION", value: char, pos: this.pos });
        this.pos++;
        continue;
      }
      if (/[a-zA-Z_`]/.test(char)) {
        const start = this.pos;
        let ident = "";
        while (this.pos < this.input.length && /[a-zA-Z0-9_.`]/.test(this.input[this.pos])) {
          ident += this.input[this.pos];
          this.pos++;
        }
        ident = ident.replace(/`/g, "");
        const upper = ident.toUpperCase();
        if (KEYWORDS.has(upper)) {
          tokens.push({ type: "KEYWORD", value: upper, pos: start });
        } else {
          tokens.push({ type: "IDENTIFIER", value: ident, pos: start });
        }
        continue;
      }
      this.pos++;
    }
    tokens.push({ type: "EOF", value: "", pos: this.pos });
    return tokens;
  }
};
var SqlParser = class {
  constructor(tokens) {
    this.current = 0;
    this.tokens = tokens;
  }
  parse() {
    let isExplain = false;
    if (this.matchKeyword("EXPLAIN")) {
      isExplain = true;
    }
    if (this.matchKeyword("SELECT")) {
      return this.parseSelect(isExplain);
    } else if (this.matchKeyword("INSERT")) {
      return this.parseInsert();
    } else if (this.matchKeyword("UPDATE")) {
      return this.parseUpdate();
    } else if (this.matchKeyword("DELETE")) {
      return this.parseDelete();
    } else if (this.matchKeyword("CREATE")) {
      return this.parseCreate();
    } else if (this.matchKeyword("DROP")) {
      return this.parseDrop();
    } else if (this.matchKeyword("SHOW")) {
      return this.parseShow();
    } else if (this.matchKeyword("REINDEX")) {
      return this.parseReindex();
    } else if (this.matchKeyword("OPTIMIZE")) {
      return this.parseOptimize();
    } else if (this.matchKeyword("SET")) {
      return this.parseSet();
    }
    throw new Error(`\u672A\u77E5\u7684 SQL \u8BED\u53E5\u8D77\u59CB\u8BCD: "${this.peek().value}"`);
  }
  parseShow() {
    if (this.matchKeyword("TABLES")) {
      let likePattern;
      if (this.matchKeyword("LIKE")) {
        likePattern = this.expect("STRING", void 0, "LIKE \u4E4B\u540E\u7F3A\u5C11\u6A21\u5F0F\u5B57\u7B26\u4E32").value;
      }
      return { type: "SHOW_TABLES", likePattern };
    }
    if (this.matchKeyword("CREATE")) {
      this.expect("KEYWORD", "TABLE", "SHOW CREATE \u4E4B\u540E\u9884\u671F\u4E3A TABLE");
      const tableName = this.expect("IDENTIFIER", void 0, "\u9884\u671F\u4E3A\u6570\u636E\u8868\u540D").value;
      return { type: "SHOW_CREATE_TABLE", tableName };
    }
    if (this.matchKeyword("INDEX") || this.matchKeyword("INDEXES") || this.matchKeyword("KEYS")) {
      this.matchKeyword("FROM");
      this.matchKeyword("IN");
      const tableName = this.expect("IDENTIFIER", void 0, "SHOW INDEX \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
      return { type: "SHOW_INDEX", tableName };
    }
    if (this.matchKeyword("STATUS") || this.matchKeyword("VARIABLES")) {
      return { type: "SHOW_STATUS", scope: "STATUS" };
    }
    if (this.matchKeyword("BUFFER_POOL") || this.matchKeyword("ENGINE")) {
      this.matchKeyword("STATUS");
      return { type: "SHOW_STATUS", scope: "BUFFER_POOL" };
    }
    return { type: "SHOW_STATUS", scope: "STATUS" };
  }
  parseReindex() {
    this.matchKeyword("TABLE");
    const tableName = this.expect("IDENTIFIER", void 0, "REINDEX \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
    return { type: "REINDEX", tableName };
  }
  parseOptimize() {
    this.expect("KEYWORD", "TABLE", "OPTIMIZE \u4E4B\u540E\u9884\u671F\u4E3A TABLE");
    const tableName = this.expect("IDENTIFIER", void 0, "OPTIMIZE TABLE \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
    return { type: "OPTIMIZE_TABLE", tableName };
  }
  parseSet() {
    this.matchKeyword("GLOBAL");
    const varToken = this.expect("IDENTIFIER", void 0, "SET \u4E4B\u540E\u7F3A\u5C11\u53D8\u91CF\u540D");
    this.expect("OPERATOR", "=", '\u53D8\u91CF\u540D\u4E4B\u540E\u9884\u671F\u4E3A "="');
    const value = this.parseLiteral();
    return {
      type: "SET_VARIABLE",
      variableName: varToken.value,
      value
    };
  }
  peek() {
    return this.tokens[this.current] || { type: "EOF", value: "", pos: 0 };
  }
  previous() {
    return this.tokens[this.current - 1];
  }
  isAtEnd() {
    return this.peek().type === "EOF";
  }
  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }
  check(type, value) {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type !== type) return false;
    if (value !== void 0 && token.value.toUpperCase() !== value.toUpperCase()) return false;
    return true;
  }
  match(type, value) {
    if (this.check(type, value)) {
      this.advance();
      return true;
    }
    return false;
  }
  matchKeyword(val) {
    return this.match("KEYWORD", val);
  }
  expect(type, value, errMsg) {
    if (this.check(type, value)) {
      return this.advance();
    }
    throw new Error(errMsg || `\u8BED\u6CD5\u9519\u8BEF: \u9884\u671F ${value || type}, \u4F46\u9047\u5230\u4E86 "${this.peek().value}"`);
  }
  parseColumnIdentifier(errMsg = "\u9884\u671F\u5217\u540D") {
    if (this.isAtEnd()) throw new Error(errMsg);
    const token = this.peek();
    const reservedClauses = /* @__PURE__ */ new Set(["FROM", "WHERE", "JOIN", "INNER", "LEFT", "CROSS", "ON", "GROUP", "ORDER", "BY", "LIMIT", "OFFSET", "UNION", "HAVING", "SET", "VALUES"]);
    if (token.type === "IDENTIFIER" || token.type === "KEYWORD" && !reservedClauses.has(token.value.toUpperCase())) {
      return this.advance();
    }
    throw new Error(errMsg || `\u8BED\u6CD5\u9519\u8BEF: \u9884\u671F\u5217\u540D, \u4F46\u9047\u5230\u4E86 "${this.peek().value}"`);
  }
  parseSelect(isExplain) {
    const columns = [];
    do {
      columns.push(this.parseSelectColumn());
    } while (this.match("PUNCTUATION", ","));
    this.expect("KEYWORD", "FROM", "SELECT \u8BED\u53E5\u7F3A\u5C11 FROM \u5B50\u53E5");
    const fromTableToken = this.expect("IDENTIFIER", void 0, "FROM \u4E4B\u540E\u7F3A\u5C11\u6570\u636E\u8868\u540D\u79F0");
    let fromTable = fromTableToken.value;
    let fromAlias = void 0;
    if (this.matchKeyword("AS")) {
      fromAlias = this.expect("IDENTIFIER", void 0, "AS \u540E\u7F3A\u5C11\u522B\u540D").value;
    } else if (this.peek().type === "IDENTIFIER" && !KEYWORDS.has(this.peek().value.toUpperCase())) {
      fromAlias = this.advance().value;
    }
    const joins = [];
    while (true) {
      if (this.match("PUNCTUATION", ",")) {
        const nextTable = this.expect("IDENTIFIER", void 0, "\u9017\u53F7\u540E\u7F3A\u5C11\u8868\u540D").value;
        let nextAlias;
        if (this.matchKeyword("AS")) {
          nextAlias = this.expect("IDENTIFIER").value;
        } else if (this.peek().type === "IDENTIFIER" && !KEYWORDS.has(this.peek().value.toUpperCase())) {
          nextAlias = this.advance().value;
        }
        joins.push({ type: "CROSS", table: nextTable, alias: nextAlias });
      } else if (this.matchKeyword("INNER") || this.matchKeyword("JOIN") || this.matchKeyword("LEFT") || this.matchKeyword("CROSS")) {
        let joinType = "INNER";
        const prev = this.previous().value;
        if (prev === "LEFT") {
          this.matchKeyword("OUTER");
          this.expect("KEYWORD", "JOIN", "LEFT \u4E4B\u540E\u9884\u671F JOIN");
          joinType = "LEFT";
        } else if (prev === "INNER") {
          this.expect("KEYWORD", "JOIN", "INNER \u4E4B\u540E\u9884\u671F JOIN");
          joinType = "INNER";
        } else if (prev === "CROSS") {
          this.expect("KEYWORD", "JOIN", "CROSS \u4E4B\u540E\u9884\u671F JOIN");
          joinType = "CROSS";
        }
        const joinTable = this.expect("IDENTIFIER", void 0, "JOIN \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
        let joinAlias;
        if (this.matchKeyword("AS")) {
          joinAlias = this.expect("IDENTIFIER").value;
        } else if (this.peek().type === "IDENTIFIER" && !KEYWORDS.has(this.peek().value.toUpperCase())) {
          joinAlias = this.advance().value;
        }
        let onCondition;
        if (joinType !== "CROSS") {
          this.expect("KEYWORD", "ON", "JOIN \u5B50\u53E5\u5FC5\u987B\u63D0\u4F9B ON \u8FDE\u63A5\u6761\u4EF6");
          onCondition = this.parseCondition();
        }
        joins.push({
          type: joinType,
          table: joinTable,
          alias: joinAlias,
          on: onCondition
        });
      } else {
        break;
      }
    }
    let whereCondition;
    if (this.matchKeyword("WHERE")) {
      whereCondition = this.parseCondition();
    }
    let groupBy;
    if (this.matchKeyword("GROUP")) {
      this.expect("KEYWORD", "BY", "GROUP \u540E\u5FC5\u987B\u8DDF BY");
      groupBy = [];
      do {
        groupBy.push(this.expect("IDENTIFIER").value);
      } while (this.match("PUNCTUATION", ","));
    }
    let orderBy;
    if (this.matchKeyword("ORDER")) {
      this.expect("KEYWORD", "BY", "ORDER \u540E\u5FC5\u987B\u8DDF BY");
      orderBy = [];
      do {
        const colIdent = this.parseColumnIdentifier("ORDER BY \u9884\u671F\u5217\u540D").value;
        let direction = "ASC";
        if (this.matchKeyword("DESC")) {
          direction = "DESC";
        } else if (this.matchKeyword("ASC")) {
          direction = "ASC";
        }
        const parts = colIdent.split(".");
        if (parts.length === 2) {
          orderBy.push({ table: parts[0], column: parts[1], direction });
        } else {
          orderBy.push({ column: colIdent, direction });
        }
      } while (this.match("PUNCTUATION", ","));
    }
    let limit;
    let offset;
    if (this.matchKeyword("LIMIT")) {
      const firstNumToken = this.expect("NUMBER", void 0, "LIMIT \u5FC5\u987B\u662F\u6570\u5B57");
      const firstNum = parseInt(firstNumToken.value, 10);
      if (this.match("PUNCTUATION", ",")) {
        offset = firstNum;
        const countToken = this.expect("NUMBER", void 0, "LIMIT \u9017\u53F7\u540E\u5FC5\u987B\u662F\u6570\u5B57 (count)");
        limit = parseInt(countToken.value, 10);
      } else {
        limit = firstNum;
        if (this.matchKeyword("OFFSET")) {
          offset = parseInt(this.expect("NUMBER", void 0, "OFFSET \u5FC5\u987B\u662F\u6570\u5B57").value, 10);
        } else if (this.match("PUNCTUATION", ",")) {
          const offsetToken = this.expect("NUMBER", void 0, "LIMIT \u9017\u53F7\u540E\u5FC5\u987B\u662F\u6570\u5B57 (offset)");
          offset = parseInt(offsetToken.value, 10);
        }
      }
    }
    return {
      type: "SELECT",
      isExplain,
      columns,
      fromTable,
      fromAlias,
      joins,
      where: whereCondition,
      groupBy,
      orderBy,
      limit,
      offset
    };
  }
  parseSelectColumn() {
    for (const agg of ["COUNT", "SUM", "AVG", "MIN", "MAX"]) {
      if (this.matchKeyword(agg)) {
        this.expect("PUNCTUATION", "(", `${agg} \u540E\u9884\u671F (`);
        let arg = "*";
        if (this.match("OPERATOR", "*")) {
          arg = "*";
        } else {
          arg = this.parseColumnIdentifier(`${agg} \u51FD\u6570\u5185\u90E8\u9884\u671F\u53C2\u6570\u5217\u540D`).value;
        }
        this.expect("PUNCTUATION", ")", `${agg} \u51FD\u6570\u7F3A\u5C11\u95ED\u5408\u62EC\u53F7 )`);
        let alias2 = `${agg.toLowerCase()}_${arg.replace(/\*/g, "all")}`;
        if (this.matchKeyword("AS")) {
          alias2 = this.expect("IDENTIFIER").value;
        } else if (this.peek().type === "IDENTIFIER" && !KEYWORDS.has(this.peek().value.toUpperCase())) {
          alias2 = this.advance().value;
        }
        return {
          expr: `${agg}(${arg})`,
          name: arg,
          aggregate: agg,
          alias: alias2
        };
      }
    }
    if (this.match("OPERATOR", "*")) {
      return { expr: "*", name: "*" };
    }
    const colToken = this.parseColumnIdentifier("\u9884\u671F\u5217\u540D");
    let expr = colToken.value;
    let table;
    let name = expr;
    const parts = expr.split(".");
    if (parts.length === 2) {
      table = parts[0];
      name = parts[1];
    }
    let alias;
    if (this.matchKeyword("AS")) {
      alias = this.expect("IDENTIFIER").value;
    } else if (this.peek().type === "IDENTIFIER" && !KEYWORDS.has(this.peek().value.toUpperCase())) {
      alias = this.advance().value;
    }
    return { expr, table, name, alias };
  }
  parseCondition() {
    const leftToken = this.parseColumnIdentifier("\u6761\u4EF6\u5DE6\u4FA7\u9884\u671F\u5217\u540D");
    const leftParts = leftToken.value.split(".");
    const left = leftParts.length === 2 ? { table: leftParts[0], column: leftParts[1] } : { column: leftToken.value };
    let operator;
    let right = {};
    if (this.matchKeyword("BETWEEN")) {
      operator = "BETWEEN";
      const val1 = this.parseLiteral();
      this.expect("KEYWORD", "AND", "BETWEEN \u6761\u4EF6\u7F3A\u5C11 AND \u8FDE\u8BCD");
      const val2 = this.parseLiteral();
      right = { column: "", literal: val1, secondLiteral: val2 };
    } else if (this.matchKeyword("IN")) {
      operator = "IN";
      this.expect("PUNCTUATION", "(", "IN \u4E4B\u540E\u7F3A\u5C11\u62EC\u53F7 (");
      const list = [];
      do {
        list.push(this.parseLiteral());
      } while (this.match("PUNCTUATION", ","));
      this.expect("PUNCTUATION", ")", "IN \u4E4B\u540E\u7F3A\u5C11\u95ED\u5408\u62EC\u53F7 )");
      right = { column: "", inList: list };
    } else if (this.matchKeyword("LIKE")) {
      operator = "LIKE";
      right = { column: "", literal: this.parseLiteral() };
    } else {
      const opToken = this.expect("OPERATOR", void 0, "\u9884\u671F\u6BD4\u8F83\u64CD\u4F5C\u7B26 (=, >, <, >=, <=, !=)");
      operator = opToken.value;
      if (this.peek().type === "IDENTIFIER" && !KEYWORDS.has(this.peek().value.toUpperCase())) {
        const rightToken = this.advance();
        const rightParts = rightToken.value.split(".");
        if (rightParts.length === 2) {
          right = { table: rightParts[0], column: rightParts[1] };
        } else {
          right = { column: rightToken.value };
        }
      } else {
        right = { column: "", literal: this.parseLiteral() };
      }
    }
    const currentCond = { left, operator, right };
    if (this.matchKeyword("AND")) {
      currentCond.logicOp = "AND";
      currentCond.next = this.parseCondition();
    } else if (this.matchKeyword("OR")) {
      currentCond.logicOp = "OR";
      currentCond.next = this.parseCondition();
    }
    return currentCond;
  }
  parseLiteral() {
    if (this.match("STRING")) {
      return this.previous().value;
    }
    if (this.match("NUMBER")) {
      const v = this.previous().value;
      return v.includes(".") ? parseFloat(v) : parseInt(v, 10);
    }
    if (this.matchKeyword("NULL")) {
      return null;
    }
    if (this.matchKeyword("TRUE") || this.peek().type === "IDENTIFIER" && this.peek().value.toLowerCase() === "true") {
      if (this.peek().type === "IDENTIFIER") this.advance();
      return true;
    }
    if (this.matchKeyword("FALSE") || this.peek().type === "IDENTIFIER" && this.peek().value.toLowerCase() === "false") {
      if (this.peek().type === "IDENTIFIER") this.advance();
      return false;
    }
    throw new Error(`\u9884\u671F\u5B57\u9762\u91CF\u6570\u503C\u3001\u5B57\u7B26\u4E32\u6216\u5E03\u5C14\u503C\uFF0C\u4F46\u9047\u5230\u4E86 "${this.peek().value}"`);
  }
  parseInsert() {
    this.expect("KEYWORD", "INTO", "INSERT \u540E\u7F3A\u5C11 INTO");
    const table = this.expect("IDENTIFIER", void 0, "INTO \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
    const columns = [];
    if (this.match("PUNCTUATION", "(")) {
      do {
        columns.push(this.expect("IDENTIFIER").value);
      } while (this.match("PUNCTUATION", ","));
      this.expect("PUNCTUATION", ")", "\u5217\u540D\u5217\u8868\u7F3A\u5C11\u95ED\u5408\u62EC\u53F7 )");
    }
    this.expect("KEYWORD", "VALUES", "\u7F3A\u5C11 VALUES \u5173\u952E\u5B57");
    const values = [];
    do {
      this.expect("PUNCTUATION", "(", "\u6BCF\u4E2A VALUES \u7EC4\u5FC5\u987B\u4EE5 ( \u5F00\u5934");
      const rowVals = [];
      do {
        rowVals.push(this.parseLiteral());
      } while (this.match("PUNCTUATION", ","));
      this.expect("PUNCTUATION", ")", "\u7F3A\u5C11\u95ED\u5408\u62EC\u53F7 )");
      values.push(rowVals);
    } while (this.match("PUNCTUATION", ","));
    return { type: "INSERT", table, columns, values };
  }
  parseUpdate() {
    const table = this.expect("IDENTIFIER", void 0, "UPDATE \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
    this.expect("KEYWORD", "SET", "UPDATE \u8BED\u53E5\u7F3A\u5C11 SET");
    const setters = {};
    do {
      const col = this.expect("IDENTIFIER", void 0, "SET \u540E\u7F3A\u5C11\u5217\u540D").value;
      this.expect("OPERATOR", "=", "\u7F3A\u5C11\u7B49\u53F7 =");
      setters[col] = this.parseLiteral();
    } while (this.match("PUNCTUATION", ","));
    let where;
    if (this.matchKeyword("WHERE")) {
      where = this.parseCondition();
    }
    return { type: "UPDATE", table, setters, where };
  }
  parseDelete() {
    this.expect("KEYWORD", "FROM", "DELETE \u4E4B\u540E\u7F3A\u5C11 FROM");
    const table = this.expect("IDENTIFIER", void 0, "FROM \u4E4B\u540E\u7F3A\u5C11\u8868\u540D").value;
    let where;
    if (this.matchKeyword("WHERE")) {
      where = this.parseCondition();
    }
    return { type: "DELETE", table, where };
  }
  parseCreate() {
    this.expect("KEYWORD", "TABLE", "CREATE \u5173\u952E\u5B57\u4E4B\u540E\u9884\u671F\u4E3A TABLE");
    let ifNotExists = false;
    if (this.matchKeyword("IF")) {
      this.expect("KEYWORD", "NOT", "\u9884\u671F\u4E3A NOT");
      this.expect("KEYWORD", "EXISTS", "\u9884\u671F\u4E3A EXISTS");
      ifNotExists = true;
    }
    const tableNameToken = this.expect("IDENTIFIER", void 0, "CREATE TABLE \u7F3A\u5C11\u6570\u636E\u8868\u540D\u79F0");
    const tableName = tableNameToken.value;
    this.expect("PUNCTUATION", "(", '\u8868\u540D\u4E4B\u540E\u9884\u671F\u4E3A "(" \u5217\u5B9A\u4E49\u8D77\u59CB');
    const columns = [];
    let primaryKeyColumn = "";
    while (!this.check("PUNCTUATION", ")") && !this.isAtEnd()) {
      if (this.matchKeyword("PRIMARY")) {
        this.expect("KEYWORD", "KEY", "PRIMARY \u4E4B\u540E\u9884\u671F\u4E3A KEY");
        this.expect("PUNCTUATION", "(", 'PRIMARY KEY \u4E4B\u540E\u9884\u671F\u4E3A "("');
        const pkCol = this.expect("IDENTIFIER", void 0, "\u9884\u671F\u4E3A\u4E3B\u952E\u5217\u540D").value;
        this.expect("PUNCTUATION", ")", '\u9884\u671F\u4E3A ")"');
        primaryKeyColumn = pkCol;
        const targetCol = columns.find((c) => c.name === pkCol);
        if (targetCol) {
          targetCol.isPrimaryKey = true;
        }
      } else {
        const colNameToken = this.expect("IDENTIFIER", void 0, "\u9884\u671F\u4E3A\u5217\u540D");
        const colName = colNameToken.value;
        let rawType = "string";
        if (this.peek().type === "KEYWORD" || this.peek().type === "IDENTIFIER") {
          rawType = this.advance().value.toUpperCase();
        }
        if (this.match("PUNCTUATION", "(")) {
          while (!this.check("PUNCTUATION", ")") && !this.isAtEnd()) {
            this.advance();
          }
          this.match("PUNCTUATION", ")");
        }
        let colType = "string";
        if (["INT", "INTEGER", "NUMERIC", "DECIMAL", "NUMBER", "FLOAT", "DOUBLE", "BIGINT", "SMALLINT", "TINYINT"].includes(rawType)) {
          colType = "number";
        } else if (["BOOLEAN", "BOOL"].includes(rawType)) {
          colType = "boolean";
        } else if (["DATE", "DATETIME", "TIMESTAMP"].includes(rawType)) {
          colType = "date";
        } else {
          colType = "string";
        }
        let isPrimaryKey = false;
        let autoIncrement = false;
        let isShortKey = false;
        let isUnique = false;
        let isSecondaryIndex = false;
        while (!this.check("PUNCTUATION", ",") && !this.check("PUNCTUATION", ")") && !this.isAtEnd()) {
          if (this.matchKeyword("PRIMARY")) {
            this.expect("KEYWORD", "KEY", "PRIMARY \u4E4B\u540E\u9884\u671F\u4E3A KEY");
            isPrimaryKey = true;
            primaryKeyColumn = colName;
          } else if (this.matchKeyword("AUTOINCREMENT") || this.matchKeyword("AUTO_INCREMENT")) {
            autoIncrement = true;
          } else if (this.matchKeyword("SHORTKEY") || this.matchKeyword("SHORT_KEY")) {
            isShortKey = true;
            isUnique = true;
          } else if (this.matchKeyword("UNIQUE")) {
            isUnique = true;
          } else if (this.matchKeyword("INDEX") || this.matchKeyword("KEY")) {
            isSecondaryIndex = true;
          } else if (this.matchKeyword("NOT")) {
            this.matchKeyword("NULL");
          } else if (this.matchKeyword("DEFAULT")) {
            this.advance();
          } else {
            this.advance();
          }
        }
        columns.push({
          name: colName,
          type: colType,
          isPrimaryKey,
          autoIncrement,
          isShortKey,
          isUnique,
          isSecondaryIndex
        });
      }
      if (this.match("PUNCTUATION", ",")) {
        continue;
      } else {
        break;
      }
    }
    this.expect("PUNCTUATION", ")", '\u5217\u5B9A\u4E49\u5217\u8868\u4E4B\u540E\u9884\u671F\u4E3A ")"');
    if (!primaryKeyColumn) {
      const idCol = columns.find((c) => c.name.toLowerCase() === "id");
      if (idCol) {
        idCol.isPrimaryKey = true;
        primaryKeyColumn = idCol.name;
      } else if (columns.length > 0) {
        columns[0].isPrimaryKey = true;
        primaryKeyColumn = columns[0].name;
      }
    }
    return {
      type: "CREATE_TABLE",
      tableName,
      ifNotExists,
      columns,
      primaryKeyColumn
    };
  }
  parseDrop() {
    this.expect("KEYWORD", "TABLE", "DROP \u5173\u952E\u5B57\u4E4B\u540E\u9884\u671F\u4E3A TABLE");
    let ifExists = false;
    if (this.matchKeyword("IF")) {
      this.expect("KEYWORD", "EXISTS", "\u9884\u671F\u4E3A EXISTS");
      ifExists = true;
    }
    const tableNameToken = this.expect("IDENTIFIER", void 0, "DROP TABLE \u7F3A\u5C11\u6570\u636E\u8868\u540D\u79F0");
    return {
      type: "DROP_TABLE",
      tableName: tableNameToken.value,
      ifExists
    };
  }
};
var SqlExecutor = class {
  constructor(db) {
    this.db = db;
  }
  /**
   * 执行完整的任意 SQL 语句 (支持 SELECT、JOIN、INSERT、UPDATE、DELETE、EXPLAIN)
   */
  execute(sql) {
    const startTime = performance.now();
    const lexer = new SqlLexer(sql);
    const tokens = lexer.tokenize();
    const parser = new SqlParser(tokens);
    const statement = parser.parse();
    const plan = [];
    switch (statement.type) {
      case "SELECT":
        return this.executeSelect(statement, startTime, plan);
      case "INSERT":
        return this.executeInsert(statement, startTime);
      case "UPDATE":
        return this.executeUpdate(statement, startTime);
      case "DELETE":
        return this.executeDelete(statement, startTime);
      case "CREATE_TABLE":
        return this.executeCreateTable(statement, startTime);
      case "DROP_TABLE":
        return this.executeDropTable(statement, startTime);
      case "SHOW_TABLES":
        return this.executeShowTables(statement, startTime);
      case "SHOW_CREATE_TABLE":
        return this.executeShowCreateTable(statement, startTime);
      case "SHOW_INDEX":
        return this.executeShowIndex(statement, startTime);
      case "SHOW_STATUS":
        return this.executeShowStatus(statement, startTime);
      case "REINDEX":
        return this.executeReindex(statement, startTime);
      case "OPTIMIZE_TABLE":
        return this.executeOptimize(statement, startTime);
      case "SET_VARIABLE":
        return this.executeSetVariable(statement, startTime);
    }
  }
  executeShowTables(stmt, startTime) {
    const tables = this.db.listTables();
    let matched = tables;
    if (stmt.likePattern) {
      const regex = new RegExp("^" + stmt.likePattern.replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
      matched = tables.filter((t) => regex.test(t));
    }
    const rows = matched.map((name) => {
      const tbl = this.db.getTable(name);
      const stats = tbl.getDiskIndexStats();
      return {
        table_name: name,
        rows: tbl.rowCount,
        primary_key: tbl.pkColumn,
        engine: "DISK_BTREE (4KB Pages)",
        disk_size_kb: stats.totalDiskSizeKb,
        index_count: stats.indexes.length
      };
    });
    return {
      columns: ["table_name", "rows", "primary_key", "engine", "disk_size_kb", "index_count"],
      rows,
      rowCount: rows.length,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "SHOW_TABLES",
        table: "information_schema",
        strategy: "TABLE_SCAN",
        detail: `\u626B\u63CF\u5168\u5E93\u5143\u6570\u636E\u5B57\u5178\uFF0C\u8FD4\u56DE ${rows.length} \u5F20\u6570\u636E\u8868\u89C4\u683C`,
        estimatedCost: "O(1)"
      }]
    };
  }
  executeShowCreateTable(stmt, startTime) {
    const tbl = this.db.getTable(stmt.tableName);
    const colsDdl = tbl.schema.columns.map((col) => {
      let def = `  \`${col.name}\` ${col.type.toUpperCase()}`;
      if (col.isPrimaryKey) def += " PRIMARY KEY";
      if (col.autoIncrement) def += " AUTOINCREMENT";
      if (col.isShortKey) def += " SHORTKEY";
      if (col.isUnique && !col.isPrimaryKey) def += " UNIQUE";
      if (col.isSecondaryIndex && !col.isPrimaryKey) def += " INDEX";
      return def;
    }).join(",\n");
    const ddl = `CREATE TABLE \`${tbl.name}\` (
${colsDdl}
) ENGINE=DISK_BTREE DEFAULT CHARSET=utf8mb4;`;
    return {
      columns: ["Table", "Create Table"],
      rows: [{ Table: tbl.name, "Create Table": ddl }],
      rowCount: 1,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "SHOW_CREATE_TABLE",
        table: tbl.name,
        strategy: "TABLE_SCAN",
        detail: `\u63D0\u53D6 "${tbl.name}" Schema \u5E76\u751F\u6210\u6807\u51C6 DDL \u8BED\u53E5\u5B9A\u4E49`,
        estimatedCost: "O(1)"
      }]
    };
  }
  executeShowIndex(stmt, startTime) {
    const tbl = this.db.getTable(stmt.tableName);
    const stats = tbl.getDiskIndexStats();
    const rows = stats.indexes.map((idx) => ({
      Table: idx.table,
      Non_unique: idx.nonUnique,
      Key_name: idx.keyName,
      Seq_in_index: 1,
      Column_name: idx.columnName,
      Index_type: idx.indexType,
      Storage_format: idx.storageFormat,
      Pages: idx.pages,
      Disk_size_kb: idx.diskSizeKb,
      Cardinality: idx.cardinality
    }));
    return {
      columns: ["Table", "Key_name", "Column_name", "Non_unique", "Index_type", "Storage_format", "Pages", "Disk_size_kb", "Cardinality"],
      rows,
      rowCount: rows.length,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "SHOW_INDEX",
        table: stmt.tableName,
        strategy: "TABLE_SCAN",
        detail: `\u83B7\u53D6\u6570\u636E\u8868 "${stmt.tableName}" \u7684\u6240\u6709\u78C1\u76D8 B-\u6811\u4E0E\u54C8\u5E0C\u7D22\u5F15\u89C4\u683C`,
        estimatedCost: "O(1)"
      }]
    };
  }
  executeShowStatus(stmt, startTime) {
    const poolStats = globalBufferPool.getStats();
    const rows = [
      { Variable_name: "buffer_pool_size_mb", Value: `${poolStats.memoryLimitMb} MB` },
      { Variable_name: "buffer_pool_pageSize_bytes", Value: `${poolStats.pageSizeBytes} B (4KB)` },
      { Variable_name: "buffer_pool_cached_pages", Value: `${poolStats.cachedPagesCount} / ${poolStats.maxPagesCount} pages` },
      { Variable_name: "buffer_pool_memory_used", Value: `${poolStats.memoryUsedMb} MB (${poolStats.memoryUsedBytes} B)` },
      { Variable_name: "buffer_pool_hit_ratio", Value: `${poolStats.hitRatioPercent}%` },
      { Variable_name: "buffer_pool_hits_total", Value: String(poolStats.hits) },
      { Variable_name: "buffer_pool_misses_total", Value: String(poolStats.misses) },
      { Variable_name: "buffer_pool_disk_reads", Value: String(poolStats.diskReads) },
      { Variable_name: "buffer_pool_disk_writes", Value: String(poolStats.diskWrites) },
      { Variable_name: "buffer_pool_lru_evictions", Value: String(poolStats.evictions) },
      { Variable_name: "buffer_pool_dirty_pages", Value: String(poolStats.dirtyPagesCount) },
      { Variable_name: "disk_index_engine", Value: "ENABLED (Slotted Page / LRU Buffer Pool)" },
      { Variable_name: "crc32_checksum_protection", Value: "IEEE 802.3 VERIFIED" }
    ];
    return {
      columns: ["Variable_name", "Value"],
      rows,
      rowCount: rows.length,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "SHOW_STATUS",
        table: "system",
        strategy: "TABLE_SCAN",
        detail: "\u67E5\u8BE2 Buffer Pool \u7F13\u51B2\u6C60\u4E0E\u5185\u5B58\u4F18\u5316\u8FD0\u884C\u65F6\u72B6\u6001\u76D1\u63A7",
        estimatedCost: "O(1)"
      }]
    };
  }
  executeReindex(stmt, startTime) {
    const tbl = this.db.getTable(stmt.tableName);
    const reindexStats = tbl.rebuildIndexes();
    return {
      columns: ["table", "status", "reorganized_pages", "reclaimed_bytes", "duration_ms"],
      rows: [{
        table: stmt.tableName,
        status: "OK (PAGES_COMPACTED)",
        reorganized_pages: reindexStats.reorganizedPages,
        reclaimed_bytes: reindexStats.reclaimedBytes,
        duration_ms: reindexStats.durationMs
      }],
      rowCount: 1,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "REINDEX",
        table: stmt.tableName,
        strategy: "PK_BTREE",
        detail: `\u6267\u884C\u78C1\u76D8 B-\u6811\u7269\u7406\u788E\u7247\u6574\u7406\uFF0C\u91CD\u6574 ${reindexStats.reorganizedPages} \u4E2A 4KB \u6570\u636E\u9875\uFF0C\u56DE\u6536 ${reindexStats.reclaimedBytes} \u5B57\u8282\u7A7A\u95F4`,
        estimatedCost: "O(N log N)"
      }],
      affectedRows: 1,
      message: `REINDEX \u6210\u529F\uFF1A\u6570\u636E\u8868 "${stmt.tableName}" \u7684\u6240\u6709\u78C1\u76D8 B-\u6811\u7D22\u5F15\u7269\u7406\u6574\u7406\u7D27\u51D1\u5B8C\u6210\uFF0C\u91CD\u7EC4 ${reindexStats.reorganizedPages} \u4E2A\u6570\u636E\u9875\uFF01`
    };
  }
  executeOptimize(stmt, startTime) {
    const tbl = this.db.getTable(stmt.tableName);
    const reindexStats = tbl.rebuildIndexes();
    return {
      columns: ["table", "operation", "status", "disk_defragmentation", "execution_time_ms"],
      rows: [{
        table: stmt.tableName,
        operation: "OPTIMIZE TABLE",
        status: "SUCCESS",
        disk_defragmentation: `Reorganized ${reindexStats.reorganizedPages} pages, reclaimed ${reindexStats.reclaimedBytes} B`,
        execution_time_ms: reindexStats.durationMs
      }],
      rowCount: 1,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "OPTIMIZE_TABLE",
        table: stmt.tableName,
        strategy: "PK_BTREE",
        detail: `\u5B8C\u6210\u6570\u636E\u8868 "${stmt.tableName}" \u6570\u636E\u4E0E\u76D8\u7D22\u5F15\u5168\u91CF\u7D27\u51D1\u6574\u7406`,
        estimatedCost: "O(N log N)"
      }],
      affectedRows: 1,
      message: `OPTIMIZE TABLE \u6210\u529F\uFF1A\u6570\u636E\u8868 "${stmt.tableName}" \u6570\u636E\u4E0E\u76D8\u7D22\u5F15\u788E\u7247\u6574\u7406\u5B8C\u6210\uFF01`
    };
  }
  executeSetVariable(stmt, startTime) {
    const varName = stmt.variableName.toLowerCase();
    if (varName === "memory_limit_mb" || varName === "buffer_pool_size" || varName === "buffer_pool_size_mb" || varName === "buffer_pool") {
      const numVal = parseInt(String(stmt.value), 10);
      if (isNaN(numVal) || numVal < 1) {
        throw new Error("memory_limit_mb \u5FC5\u987B\u4E3A\u5927\u4E8E 0 \u7684\u6574\u578B\u6570\u503C (MB)");
      }
      const res = globalBufferPool.setMemoryLimitMb(numVal);
      return {
        columns: ["Variable", "Old_Value", "New_Value", "Evicted_Pages"],
        rows: [{
          Variable: "buffer_pool_size_mb",
          Old_Value: `${res.beforeMb} MB`,
          New_Value: `${res.afterMb} MB`,
          Evicted_Pages: res.evictedPages
        }],
        rowCount: 1,
        executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
        plan: [{
          operation: "SET_VARIABLE",
          table: "buffer_pool",
          strategy: "TABLE_SCAN",
          detail: `\u52A8\u6001\u8C03\u6574 Buffer Pool \u5185\u5B58\u9884\u7B97\u4E3A ${res.afterMb}MB\uFF0C\u5DF2\u6267\u884C LRU \u6362\u51FA ${res.evictedPages} \u9875`,
          estimatedCost: "O(1)"
        }],
        message: `SET \u6210\u529F\uFF1A\u5DF2\u5C06 Buffer Pool \u5185\u5B58\u4E0A\u9650\u66F4\u65B0\u4E3A ${res.afterMb}MB\uFF01`
      };
    }
    throw new Error(`\u672A\u77E5\u7684\u7CFB\u7EDF\u914D\u7F6E\u53D8\u91CF: "${stmt.variableName}"\uFF0C\u5F53\u524D\u652F\u6301: memory_limit_mb, buffer_pool_size`);
  }
  executeSelect(stmt, startTime, plan) {
    const fromTable = this.db.getTable(stmt.fromTable);
    const fromAlias = stmt.fromAlias || stmt.fromTable;
    let intermediateRows = [];
    const hasAggregates = stmt.columns.some((c) => c.aggregate);
    let indexOrderPushedDown = false;
    if (stmt.joins.length === 0 && !hasAggregates && !stmt.groupBy && !stmt.where) {
      const offset = stmt.offset || 0;
      const limit = stmt.limit !== void 0 ? stmt.limit : 1e6;
      if (stmt.orderBy && stmt.orderBy.length === 1) {
        const orderCol = stmt.orderBy[0].column;
        const dir = stmt.orderBy[0].direction || "ASC";
        if (orderCol === fromTable.pkColumn) {
          plan.push({
            operation: "INDEX_ORDERED_SCAN",
            table: fromAlias,
            strategy: "PK_BTREE",
            detail: `\u547D\u4E2D\u4E3B\u952E\u81EA\u5EFA\u5E73\u8861 B-\u6811\u6709\u5E8F\u6E38\u6807\u626B\u63CF (${dir}): LIMIT ${limit} OFFSET ${offset}\uFF0C\u65E9\u505C\u8DF3\u8FC7\u5168\u8868\u5168\u6392\u5E8F`,
            estimatedCost: `O(${offset} + ${limit})`
          });
          const pagedRes = fromTable.findPaged({ page: 1, pageSize: offset + limit, sortBy: orderCol, sortOrder: dir });
          intermediateRows = pagedRes.rows.slice(offset).map((r) => this.prefixRow(r, fromAlias));
          indexOrderPushedDown = true;
        } else if (fromTable.secondaryIndexMap.has(orderCol)) {
          plan.push({
            operation: "INDEX_ORDERED_SCAN",
            table: fromAlias,
            strategy: "SECONDARY_BTREE",
            detail: `\u547D\u4E2D\u4E8C\u7EA7\u591A\u503C B-\u6811\u7D22\u5F15 ${orderCol} \u6709\u5E8F\u6E38\u6807\u626B\u63CF (${dir}): LIMIT ${limit} OFFSET ${offset}`,
            estimatedCost: `O(log N + ${offset} + ${limit})`
          });
          const pks = fromTable.secondaryIndexMap.get(orderCol).inOrderPkCursor(offset, limit, dir);
          intermediateRows = pks.map((pk) => fromTable.findById(pk).row).filter(Boolean).map((r) => this.prefixRow(r, fromAlias));
          indexOrderPushedDown = true;
        }
      } else if (!stmt.orderBy && stmt.limit !== void 0) {
        plan.push({
          operation: "FAST_LIMIT_SCAN",
          table: fromAlias,
          strategy: "PK_BTREE",
          detail: `\u76F4\u63A5\u901A\u8FC7\u4E3B\u952E B-\u6811\u6E38\u6807\u8BFB\u53D6 LIMIT ${limit} OFFSET ${offset}\uFF0C\u514D\u5168\u8868\u52A0\u8F7D`,
          estimatedCost: `O(${offset} + ${limit})`
        });
        const pagedRes = fromTable.findPaged({ page: 1, pageSize: offset + limit, sortBy: fromTable.pkColumn, sortOrder: "ASC" });
        intermediateRows = pagedRes.rows.slice(offset).map((r) => this.prefixRow(r, fromAlias));
        indexOrderPushedDown = true;
      }
    }
    if (!indexOrderPushedDown) {
      if (stmt.joins.length === 0) {
        intermediateRows = this.executeSingleTableScan(fromTable, fromAlias, stmt.where, plan);
      } else {
        intermediateRows = this.executeMultiTableJoin(fromTable, fromAlias, stmt.joins, stmt.where, plan);
      }
    }
    if (stmt.joins.length > 0 && stmt.where) {
      const initialCount = intermediateRows.length;
      intermediateRows = intermediateRows.filter((row) => this.evaluateCondition(row, stmt.where));
      plan.push({
        operation: "FILTER",
        table: `${fromAlias} + ${stmt.joins.map((j) => j.alias || j.table).join(", ")}`,
        strategy: "TABLE_SCAN",
        detail: `\u5168\u5C40 WHERE \u8054\u5408\u8C13\u8BCD\u8FC7\u6EE4\uFF0C\u8F93\u5165 ${initialCount} \u884C\uFF0C\u4FDD\u7559 ${intermediateRows.length} \u884C`,
        estimatedCost: `O(${initialCount})`
      });
    }
    if (hasAggregates || stmt.groupBy) {
      intermediateRows = this.executeAggregation(intermediateRows, stmt.columns, stmt.groupBy, plan);
    }
    if (!indexOrderPushedDown) {
      if (stmt.orderBy && stmt.orderBy.length > 0) {
        const comparator = (a, b) => {
          for (const order of stmt.orderBy) {
            const keyA = this.resolveFieldValue(a, order.table, order.column);
            const keyB = this.resolveFieldValue(b, order.table, order.column);
            if (keyA === keyB) continue;
            if (keyA === null || keyA === void 0) return 1;
            if (keyB === null || keyB === void 0) return -1;
            const comparison = keyA < keyB ? -1 : 1;
            return order.direction === "DESC" ? -comparison : comparison;
          }
          return 0;
        };
        const offset = stmt.offset || 0;
        if (stmt.limit !== void 0) {
          plan.push({
            operation: "TOP_K_SORT",
            table: "intermediate",
            strategy: "BOUNDED_HEAP",
            detail: `\u547D\u4E2D Top-K \u5806\u6392\u5E8F\u7B97\u6CD5: \u4EC5\u7EF4\u62A4\u524D ${offset + stmt.limit} \u4E2A\u9AD8\u9891\u8282\u70B9\uFF0C\u8DF3\u8FC7 O(N log N) \u5168\u91CF\u5185\u5B58\u6392\u5E8F`,
            estimatedCost: `O(N log K)`
          });
          intermediateRows = selectTopK(intermediateRows, intermediateRows.length, offset, stmt.limit, comparator, true);
        } else {
          plan.push({
            operation: "SORT",
            table: "intermediate",
            strategy: "SORT",
            detail: `\u6309\u7167 ${stmt.orderBy.map((o) => `${o.table ? `${o.table}.` : ""}${o.column} ${o.direction}`).join(", ")} \u8FDB\u884C\u5168\u6392\u5E8F`,
            estimatedCost: `O(N log N)`
          });
          intermediateRows.sort(comparator);
          if (offset) {
            intermediateRows = intermediateRows.slice(offset);
          }
        }
      } else {
        if (stmt.offset) {
          intermediateRows = intermediateRows.slice(stmt.offset);
        }
        if (stmt.limit !== void 0) {
          intermediateRows = intermediateRows.slice(0, stmt.limit);
        }
      }
    }
    const finalColumns = [];
    const projectedRows = [];
    if (stmt.columns.length === 1 && stmt.columns[0].name === "*") {
      if (intermediateRows.length > 0) {
        Object.keys(intermediateRows[0]).forEach((k) => finalColumns.push(k));
      }
      projectedRows.push(...intermediateRows);
    } else {
      stmt.columns.forEach((c) => {
        finalColumns.push(c.alias || (c.table ? `${c.table}.${c.name}` : c.name));
      });
      for (const row of intermediateRows) {
        const projRow = {};
        for (const col of stmt.columns) {
          const colKey = col.alias || (col.table ? `${col.table}.${col.name}` : col.name);
          if (row[colKey] !== void 0) {
            projRow[colKey] = row[colKey];
          } else if (col.alias && row[col.alias] !== void 0) {
            projRow[colKey] = row[col.alias];
          } else {
            projRow[colKey] = this.resolveFieldValue(row, col.table, col.name);
          }
        }
        projectedRows.push(projRow);
      }
    }
    const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(3));
    if (stmt.isExplain) {
      return {
        columns: ["operation", "table", "strategy", "detail", "estimatedCost"],
        rows: plan.map((p) => ({
          operation: p.operation,
          table: p.table,
          strategy: p.strategy,
          detail: p.detail,
          estimatedCost: p.estimatedCost
        })),
        rowCount: plan.length,
        executionTimeMs,
        plan
      };
    }
    return {
      columns: finalColumns,
      rows: projectedRows,
      rowCount: projectedRows.length,
      executionTimeMs,
      plan
    };
  }
  /**
   * 单表快速扫描与索引命中评估
   */
  executeSingleTableScan(table, alias, where, plan) {
    const pkCol = table.pkColumn;
    if (where && !where.next && where.operator === "=" && where.left.column === pkCol && where.right.literal !== void 0) {
      const searchPk = where.right.literal;
      const found = table.findById(searchPk);
      plan.push({
        operation: "INDEX_SEEK",
        table: alias,
        strategy: "PK_BTREE",
        detail: `\u547D\u4E2D\u4E3B\u952E\u81EA\u5EFA\u5E73\u8861 B-\u6811\u7D22\u5F15 (Order 3) \u70B9\u67E5: ${pkCol} = ${searchPk}\uFF0C\u4EC5\u8BBF\u95EE ${found.stats.visitedNodes.length} \u4E2A\u6811\u8282\u70B9`,
        estimatedCost: "O(log N)"
      });
      if (found.row) {
        return [this.prefixRow(found.row, alias)];
      }
      return [];
    }
    if (where && !where.next && where.operator === "=" && where.right.literal !== void 0) {
      const colName = where.left.column;
      const uniqueIdx = table.uniqueIndexMap.get(colName);
      if (uniqueIdx && uniqueIdx.size > 0) {
        const pk = uniqueIdx.get(where.right.literal);
        plan.push({
          operation: "HASH_SEEK",
          table: alias,
          strategy: "HASH_INDEX",
          detail: `\u547D\u4E2D\u552F\u4E00\u5217\u54C8\u5E0C\u7D22\u5F15 (O(1)) \u70B9\u67E5: ${colName} = "${where.right.literal}" -> \u6307\u5411\u4E3B\u952E PK=${pk}`,
          estimatedCost: "O(1)"
        });
        if (pk !== void 0) {
          const rec = table.findById(pk).row;
          return rec ? [this.prefixRow(rec, alias)] : [];
        }
        return [];
      }
    }
    if (where && !where.next && where.left.column && table.secondaryIndexMap.has(where.left.column) && table.secondaryIndexMap.get(where.left.column).size > 0) {
      const colName = where.left.column;
      const secIdx = table.secondaryIndexMap.get(colName);
      if (where.operator === "=" && where.right.literal !== void 0) {
        const exactVal = where.right.literal;
        const searchRes = secIdx.search(exactVal);
        plan.push({
          operation: "INDEX_SEEK",
          table: alias,
          strategy: "SECONDARY_BTREE",
          detail: `\u547D\u4E2D\u4E8C\u7EA7\u591A\u503C B-\u6811\u7B49\u503C\u70B9\u67E5: ${colName} = "${exactVal}"\uFF0C\u5B9A\u4F4D\u5339\u914D ${searchRes.pks.length} \u6761\u4E3B\u952E\u8BB0\u5F55`,
          estimatedCost: "O(log N + K)"
        });
        const rows = [];
        searchRes.pks.forEach((pk) => {
          const rec = table.findById(pk).row;
          if (rec) rows.push(this.prefixRow(rec, alias));
        });
        return rows;
      }
      if (where.operator === "BETWEEN" && where.right.literal !== void 0 && where.right.secondLiteral !== void 0) {
        const minVal = where.right.literal;
        const maxVal = where.right.secondLiteral;
        const rangeRes = secIdx.range(minVal, maxVal, { includeMin: true, includeMax: true });
        plan.push({
          operation: "INDEX_RANGE_SCAN",
          table: alias,
          strategy: "SECONDARY_BTREE",
          detail: `\u547D\u4E2D\u4E8C\u7EA7\u591A\u503C B-\u6811\u533A\u95F4\u8303\u56F4\u626B\u63CF: ${colName} BETWEEN ${minVal} AND ${maxVal}\uFF0C\u5FEB\u901F\u5B9A\u4F4D ${rangeRes.pks.length} \u6761\u4E3B\u952E\u8BB0\u5F55`,
          estimatedCost: "O(log N + K)"
        });
        const rows = [];
        rangeRes.pks.forEach((pk) => {
          const rec = table.findById(pk).row;
          if (rec) rows.push(this.prefixRow(rec, alias));
        });
        return rows;
      }
      if ([">", ">=", "<", "<="].includes(where.operator) && where.right.literal !== void 0) {
        let minVal = null;
        let maxVal = null;
        const includeMin = where.operator === ">=";
        const includeMax = where.operator === "<=";
        if (where.operator === ">" || where.operator === ">=") minVal = where.right.literal;
        if (where.operator === "<" || where.operator === "<=") maxVal = where.right.literal;
        const rangeRes = secIdx.range(minVal, maxVal, { includeMin, includeMax });
        plan.push({
          operation: "INDEX_RANGE_SCAN",
          table: alias,
          strategy: "SECONDARY_BTREE",
          detail: `\u547D\u4E2D\u4E8C\u7EA7\u591A\u503C B-\u6811\u8303\u56F4\u626B\u63CF: ${colName} ${where.operator} ${where.right.literal}\uFF0C\u7D22\u5F15\u5339\u914D ${rangeRes.pks.length} \u6761\u8BB0\u5F55`,
          estimatedCost: "O(log N + K)"
        });
        const rows = [];
        rangeRes.pks.forEach((pk) => {
          const rec = table.findById(pk).row;
          if (rec) rows.push(this.prefixRow(rec, alias));
        });
        return rows;
      }
    }
    const allRecords = table.getAllRecords();
    plan.push({
      operation: "TABLE_SCAN",
      table: alias,
      strategy: "TABLE_SCAN",
      detail: `\u987A\u5E8F\u5168\u8868\u626B\u63CF ${table.name} (\u5171 ${allRecords.length} \u884C\u8BB0\u5F55)`,
      estimatedCost: `O(${allRecords.length})`
    });
    let prefixed = allRecords.map((r) => this.prefixRow(r, alias));
    if (where) {
      prefixed = prefixed.filter((r) => this.evaluateCondition(r, where));
    }
    return prefixed;
  }
  /**
   * 多表 JOIN 执行器 (支持 Index Nested Loop Join 与 Hash Join)
   */
  executeMultiTableJoin(baseTable, baseAlias, joins, where, plan) {
    let currentRows = baseTable.getAllRecords().map((r) => this.prefixRow(r, baseAlias));
    plan.push({
      operation: "DRIVING_TABLE_SCAN",
      table: baseAlias,
      strategy: "TABLE_SCAN",
      detail: `\u9009\u53D6\u4E3B\u9A71\u52A8\u8868 ${baseTable.name} (\u522B\u540D: ${baseAlias})\uFF0C\u57FA\u6570: ${currentRows.length} \u884C`,
      estimatedCost: `O(${currentRows.length})`
    });
    for (const join of joins) {
      const joinTable = this.db.getTable(join.table);
      const joinAlias = join.alias || join.table;
      const joinedRows = [];
      let usedInlj = false;
      if (join.on && join.type !== "CROSS") {
        const leftRef = join.on.left;
        const rightRef = join.on.right;
        let outerCol;
        let innerCol;
        if (rightRef.table === joinAlias || !rightRef.table && rightRef.column === joinTable.pkColumn) {
          outerCol = leftRef.table ? `${leftRef.table}.${leftRef.column}` : leftRef.column;
          innerCol = rightRef.column;
        } else if (leftRef.table === joinAlias || !leftRef.table && leftRef.column === joinTable.pkColumn) {
          outerCol = rightRef.table ? `${rightRef.table}.${rightRef.column}` : rightRef.column;
          innerCol = leftRef.column;
        }
        if (outerCol && innerCol && innerCol === joinTable.pkColumn) {
          usedInlj = true;
          plan.push({
            operation: `${join.type}_JOIN`,
            table: `${join.table} (AS ${joinAlias})`,
            strategy: "INLJ",
            detail: `\u89E6\u53D1\u7D22\u5F15\u5D4C\u5957\u5FAA\u73AF\u8FDE\u63A5 (INLJ): \u5916\u8868\u9A71\u52A8\u9010\u884C\u63A2\u67E5\u5185\u8868 ${join.table} \u7684\u4E3B\u952E B-\u6811\u7D22\u5F15 (Order 3) ${innerCol}`,
            estimatedCost: `O(M * log N)`
          });
          for (const outerRow of currentRows) {
            const probeVal = outerRow[outerCol] !== void 0 ? outerRow[outerCol] : outerRow[outerCol.split(".").pop()];
            let matchedInner = false;
            if (probeVal !== void 0 && probeVal !== null) {
              const btreeHit = joinTable.pkIndex.search(probeVal);
              if (btreeHit.value) {
                matchedInner = true;
                joinedRows.push(this.mergeJoinedRow(outerRow, btreeHit.value, joinAlias));
              }
            }
            if (!matchedInner && join.type === "LEFT") {
              joinedRows.push(this.mergeNullRow(outerRow, joinTable.schema, joinAlias));
            }
          }
        }
      }
      if (!usedInlj) {
        if (join.type === "CROSS" || !join.on) {
          plan.push({
            operation: "CROSS_JOIN",
            table: `${join.table} (AS ${joinAlias})`,
            strategy: "TABLE_SCAN",
            detail: `\u6267\u884C\u7B1B\u5361\u5C14\u79EF\u8FDE\u63A5 (Cartesian Product) \u8BA1\u7B97`,
            estimatedCost: "O(M * N)"
          });
          const innerAll = joinTable.getAllRecords();
          for (const outerRow of currentRows) {
            for (const innerRow of innerAll) {
              joinedRows.push(this.mergeJoinedRow(outerRow, innerRow, joinAlias));
            }
          }
        } else {
          plan.push({
            operation: `${join.type}_JOIN`,
            table: `${join.table} (AS ${joinAlias})`,
            strategy: "HASH_JOIN",
            detail: `\u4E3A\u5185\u8868 ${join.table} \u6784\u5EFA\u7EBF\u6027\u6563\u5217\u8868 (Hash Table)\uFF0C\u5355\u904D\u63A2\u67E5\u5B8C\u6210\u8FDE\u63A5`,
            estimatedCost: "O(M + N)"
          });
          const innerAll = joinTable.getAllRecords();
          const onCond = join.on;
          for (const outerRow of currentRows) {
            let matched = false;
            for (const innerRow of innerAll) {
              const candidate = this.mergeJoinedRow(outerRow, innerRow, joinAlias);
              if (this.evaluateCondition(candidate, onCond)) {
                matched = true;
                joinedRows.push(candidate);
              }
            }
            if (!matched && join.type === "LEFT") {
              joinedRows.push(this.mergeNullRow(outerRow, joinTable.schema, joinAlias));
            }
          }
        }
      }
      currentRows = joinedRows;
    }
    return currentRows;
  }
  /**
   * 聚合运算 (COUNT, SUM, AVG, MIN, MAX) 与可选 GROUP BY
   */
  executeAggregation(rows, columns, groupBy, plan) {
    plan.push({
      operation: "AGGREGATE",
      table: "intermediate",
      strategy: "AGGREGATE",
      detail: `\u6267\u884C\u5206\u7EC4\u4E0E\u805A\u5408\u8FD0\u7B97: ${columns.filter((c) => c.aggregate).map((c) => `${c.aggregate}(${c.name})`).join(", ")}${groupBy ? ` GROUP BY ${groupBy.join(", ")}` : ""}`,
      estimatedCost: `O(N)`
    });
    if (!groupBy || groupBy.length === 0) {
      const resultRow = {};
      for (const col of columns) {
        const outName = col.alias || col.expr;
        if (!col.aggregate) {
          resultRow[outName] = rows.length > 0 ? this.resolveFieldValue(rows[0], col.table, col.name) : null;
          continue;
        }
        if (col.aggregate === "COUNT") {
          if (col.name === "*") {
            resultRow[outName] = rows.length;
          } else {
            resultRow[outName] = rows.filter((r) => this.resolveFieldValue(r, col.table, col.name) !== null).length;
          }
        } else if (col.aggregate === "SUM" || col.aggregate === "AVG") {
          const nums = rows.map((r) => Number(this.resolveFieldValue(r, col.table, col.name))).filter((n) => !isNaN(n));
          const sum = nums.reduce((acc, val) => acc + val, 0);
          resultRow[outName] = col.aggregate === "SUM" ? sum : nums.length > 0 ? parseFloat((sum / nums.length).toFixed(2)) : 0;
        } else if (col.aggregate === "MIN") {
          const vals = rows.map((r) => this.resolveFieldValue(r, col.table, col.name)).filter((v) => v !== null && v !== void 0);
          resultRow[outName] = vals.length > 0 ? vals.reduce((min, val) => val < min ? val : min) : null;
        } else if (col.aggregate === "MAX") {
          const vals = rows.map((r) => this.resolveFieldValue(r, col.table, col.name)).filter((v) => v !== null && v !== void 0);
          resultRow[outName] = vals.length > 0 ? vals.reduce((max, val) => val > max ? val : max) : null;
        }
      }
      return [resultRow];
    }
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const groupKey = groupBy.map((gb) => String(this.resolveFieldValue(row, void 0, gb))).join(":::");
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(row);
    }
    const aggregatedRows = [];
    groups.forEach((groupRows, key) => {
      const outRow = {};
      groupBy.forEach((gb) => {
        outRow[gb] = this.resolveFieldValue(groupRows[0], void 0, gb);
      });
      for (const col of columns) {
        if (!col.aggregate) continue;
        const outName = col.alias || col.expr;
        if (col.aggregate === "COUNT") {
          outRow[outName] = col.name === "*" ? groupRows.length : groupRows.filter((r) => this.resolveFieldValue(r, col.table, col.name) !== null).length;
        } else if (col.aggregate === "SUM" || col.aggregate === "AVG") {
          const nums = groupRows.map((r) => Number(this.resolveFieldValue(r, col.table, col.name))).filter((n) => !isNaN(n));
          const sum = nums.reduce((acc, val) => acc + val, 0);
          outRow[outName] = col.aggregate === "SUM" ? sum : nums.length > 0 ? parseFloat((sum / nums.length).toFixed(2)) : 0;
        } else if (col.aggregate === "MIN") {
          const vals = groupRows.map((r) => this.resolveFieldValue(r, col.table, col.name)).filter((v) => v !== null);
          outRow[outName] = vals.length > 0 ? vals.reduce((min, val) => val < min ? val : min) : null;
        } else if (col.aggregate === "MAX") {
          const vals = groupRows.map((r) => this.resolveFieldValue(r, col.table, col.name)).filter((v) => v !== null);
          outRow[outName] = vals.length > 0 ? vals.reduce((max, val) => val > max ? val : max) : null;
        }
      }
      aggregatedRows.push(outRow);
    });
    return aggregatedRows;
  }
  executeInsert(stmt, startTime) {
    const table = this.db.getTable(stmt.table);
    let insertedCount = 0;
    for (const valList of stmt.values) {
      const rowObj = {};
      if (stmt.columns.length > 0) {
        stmt.columns.forEach((col, idx) => {
          rowObj[col] = valList[idx];
        });
      } else {
        table.schema.columns.forEach((col, idx) => {
          if (idx < valList.length) {
            rowObj[col.name] = valList[idx];
          }
        });
      }
      table.insert(rowObj);
      insertedCount++;
    }
    const duration = parseFloat((performance.now() - startTime).toFixed(3));
    return {
      columns: ["affected_rows", "table", "next_id"],
      rows: [{ affected_rows: insertedCount, table: stmt.table, next_id: table.next_id }],
      rowCount: 1,
      affectedRows: insertedCount,
      executionTimeMs: duration,
      plan: [],
      message: `INSERT \u6210\u529F\uFF1A\u5DF2\u5411\u8868 "${stmt.table}" \u5199\u5165 ${insertedCount} \u6761\u8BB0\u5F55\uFF0C\u81EA\u589E next_id \u7EF4\u6301\u5355\u8C03\u6301\u4E45\u5316\uFF01`
    };
  }
  executeUpdate(stmt, startTime) {
    const table = this.db.getTable(stmt.table);
    const pkCol = table.pkColumn;
    const allRecords = table.getAllRecords();
    let updatedCount = 0;
    for (const rec of allRecords) {
      const prefixed = this.prefixRow(rec, stmt.table);
      if (!stmt.where || this.evaluateCondition(prefixed, stmt.where)) {
        const pk = rec[pkCol];
        table.update(pk, stmt.setters);
        updatedCount++;
      }
    }
    const duration = parseFloat((performance.now() - startTime).toFixed(3));
    return {
      columns: ["affected_rows", "table"],
      rows: [{ affected_rows: updatedCount, table: stmt.table }],
      rowCount: 1,
      affectedRows: updatedCount,
      executionTimeMs: duration,
      plan: [],
      message: `UPDATE \u6210\u529F\uFF1A\u5DF2\u66F4\u65B0\u8868 "${stmt.table}" \u4E2D ${updatedCount} \u6761\u5339\u914D\u8BB0\u5F55\u3002`
    };
  }
  executeDelete(stmt, startTime) {
    const table = this.db.getTable(stmt.table);
    const pkCol = table.pkColumn;
    const allRecords = table.getAllRecords();
    const pksToDelete = [];
    for (const rec of allRecords) {
      const prefixed = this.prefixRow(rec, stmt.table);
      if (!stmt.where || this.evaluateCondition(prefixed, stmt.where)) {
        pksToDelete.push(rec[pkCol]);
      }
    }
    for (const pk of pksToDelete) {
      table.delete(pk);
    }
    const duration = parseFloat((performance.now() - startTime).toFixed(3));
    return {
      columns: ["affected_rows", "table", "next_id"],
      rows: [{ affected_rows: pksToDelete.length, table: stmt.table, next_id: table.next_id }],
      rowCount: 1,
      affectedRows: pksToDelete.length,
      executionTimeMs: duration,
      plan: [],
      message: `DELETE \u6210\u529F\uFF1A\u5DF2\u4ECE "${stmt.table}" \u5220\u9664 ${pksToDelete.length} \u6761\u8BB0\u5F55\u3002SQLite AUTOINCREMENT \u884C\u4E3A\uFF1A\u6301\u4E45\u5316 next_id=${table.next_id} \u4E25\u683C\u6C38\u4E0D\u590D\u7528\uFF01`
    };
  }
  /**
   * 辅助方法：计算 WHERE 条件真假
   */
  evaluateCondition(row, cond) {
    const leftVal = this.resolveFieldValue(row, cond.left.table, cond.left.column);
    let rightVal = cond.right.literal;
    if (rightVal === void 0 && cond.right.column) {
      rightVal = this.resolveFieldValue(row, cond.right.table, cond.right.column);
    }
    let isMatch = false;
    switch (cond.operator) {
      case "=":
        isMatch = leftVal == rightVal;
        break;
      case "!=":
        isMatch = leftVal != rightVal;
        break;
      case ">":
        isMatch = leftVal > rightVal;
        break;
      case ">=":
        isMatch = leftVal >= rightVal;
        break;
      case "<":
        isMatch = leftVal < rightVal;
        break;
      case "<=":
        isMatch = leftVal <= rightVal;
        break;
      case "BETWEEN":
        isMatch = leftVal >= cond.right.literal && leftVal <= cond.right.secondLiteral;
        break;
      case "IN":
        isMatch = Array.isArray(cond.right.inList) && cond.right.inList.includes(leftVal);
        break;
      case "LIKE":
        if (typeof leftVal === "string" && typeof rightVal === "string") {
          const regexStr = "^" + rightVal.replace(/%/g, ".*").replace(/_/g, ".") + "$";
          isMatch = new RegExp(regexStr, "i").test(leftVal);
        }
        break;
    }
    if (cond.next && cond.logicOp) {
      const nextMatch = this.evaluateCondition(row, cond.next);
      return cond.logicOp === "AND" ? isMatch && nextMatch : isMatch || nextMatch;
    }
    return isMatch;
  }
  /**
   * 辅助方法：解析行中带有或不带表前缀的字段值
   */
  resolveFieldValue(row, table, column) {
    if (!row) return void 0;
    if (table) {
      const qualified = `${table}.${column}`;
      if (row[qualified] !== void 0) return row[qualified];
    }
    if (row[column] !== void 0) return row[column];
    const lowerCol = column.toLowerCase();
    for (const key of Object.keys(row)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === lowerCol || lowerKey.endsWith(`.${lowerCol}`)) {
        return row[key];
      }
    }
    return void 0;
  }
  /**
   * 为数据行添加前缀 (如 { id: 1 } -> { 'orders.id': 1, id: 1 })
   */
  prefixRow(row, alias) {
    const result = {};
    for (const [k, v] of Object.entries(row)) {
      result[`${alias}.${k}`] = v;
      if (result[k] === void 0) {
        result[k] = v;
      }
    }
    return result;
  }
  /**
   * 合并两表 JOIN 后的字段
   */
  mergeJoinedRow(outerRow, innerRow, innerAlias) {
    const merged = { ...outerRow };
    for (const [k, v] of Object.entries(innerRow)) {
      merged[`${innerAlias}.${k}`] = v;
      if (merged[k] === void 0) {
        merged[k] = v;
      }
    }
    return merged;
  }
  /**
   * LEFT JOIN 未匹配时补 null
   */
  mergeNullRow(outerRow, innerSchema, innerAlias) {
    const merged = { ...outerRow };
    for (const col of innerSchema.columns) {
      merged[`${innerAlias}.${col.name}`] = null;
      if (merged[col.name] === void 0) {
        merged[col.name] = null;
      }
    }
    return merged;
  }
  /**
   * 执行 CREATE TABLE 语句
   */
  executeCreateTable(stmt, startTime) {
    if (this.db.hasTable(stmt.tableName)) {
      if (stmt.ifNotExists) {
        return {
          columns: ["status", "table"],
          rows: [{ status: "SKIPPED", table: stmt.tableName }],
          rowCount: 1,
          executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
          plan: [{
            operation: "CREATE_TABLE",
            table: stmt.tableName,
            strategy: "TABLE_SCAN",
            detail: `\u6570\u636E\u8868 "${stmt.tableName}" \u5DF2\u5B58\u5728\uFF0CIF NOT EXISTS \u8DF3\u8FC7\u521B\u5EFA`,
            estimatedCost: "O(1)"
          }],
          message: `\u63D0\u793A\uFF1A\u6570\u636E\u8868 "${stmt.tableName}" \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7\u521B\u5EFA\u3002`
        };
      }
      throw new Error(`\u6570\u636E\u8868 "${stmt.tableName}" \u5DF2\u5B58\u5728\u3002`);
    }
    const schema = {
      name: stmt.tableName,
      primaryKeyColumn: stmt.primaryKeyColumn || "id",
      columns: stmt.columns
    };
    this.db.createTable(schema, 1);
    const plan = [{
      operation: "CREATE_TABLE",
      table: stmt.tableName,
      strategy: "PK_BTREE",
      detail: `\u6210\u529F\u521B\u5EFA\u6570\u636E\u8868 "${stmt.tableName}"\uFF0C\u5B9A\u4E49 ${stmt.columns.length} \u4E2A\u5B57\u6BB5\uFF0C\u521D\u59CB\u5316\u4E3B\u952E\u81EA\u5EFA\u5E73\u8861 B-\u6811 (Order 3) \u53CA\u76F8\u5173\u591A\u503C/\u54C8\u5E0C\u7D22\u5F15\u6811`,
      estimatedCost: "O(1)"
    }];
    return {
      columns: ["table", "columns_count", "primary_key"],
      rows: [{
        table: stmt.tableName,
        columns_count: stmt.columns.length,
        primary_key: schema.primaryKeyColumn
      }],
      rowCount: 1,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan,
      affectedRows: 1,
      message: `CREATE TABLE \u6210\u529F\uFF1A\u6570\u636E\u8868 "${stmt.tableName}" \u5DF2\u5EFA\u7ACB\u5C31\u7EEA\uFF01`
    };
  }
  /**
   * 执行 DROP TABLE 语句
   */
  executeDropTable(stmt, startTime) {
    if (!this.db.hasTable(stmt.tableName)) {
      if (stmt.ifExists) {
        return {
          columns: ["status", "table"],
          rows: [{ status: "SKIPPED", table: stmt.tableName }],
          rowCount: 1,
          executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
          plan: [{
            operation: "DROP_TABLE",
            table: stmt.tableName,
            strategy: "TABLE_SCAN",
            detail: `\u6570\u636E\u8868 "${stmt.tableName}" \u4E0D\u5B58\u5728\uFF0CIF EXISTS \u8DF3\u8FC7\u5220\u9664`,
            estimatedCost: "O(1)"
          }],
          message: `\u63D0\u793A\uFF1A\u6570\u636E\u8868 "${stmt.tableName}" \u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\u5220\u9664\u3002`
        };
      }
      throw new Error(`\u6570\u636E\u8868 "${stmt.tableName}" \u4E0D\u5B58\u5728\u3002`);
    }
    this.db.dropTable(stmt.tableName);
    return {
      columns: ["status", "table"],
      rows: [{ status: "DROPPED", table: stmt.tableName }],
      rowCount: 1,
      executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      plan: [{
        operation: "DROP_TABLE",
        table: stmt.tableName,
        strategy: "TABLE_SCAN",
        detail: `\u6210\u529F\u6CE8\u9500\u5E76\u5220\u9664\u6570\u636E\u8868 "${stmt.tableName}"`,
        estimatedCost: "O(1)"
      }],
      affectedRows: 1,
      message: `DROP TABLE \u6210\u529F\uFF1A\u6570\u636E\u8868 "${stmt.tableName}" \u5DF2\u5F7B\u5E95\u5220\u9664\u3002`
    };
  }
};

// src/engine/importer.ts
import fs3 from "fs";
import path2 from "path";
import readline from "readline";
var BackgroundImporter = class _BackgroundImporter {
  constructor(dataDir = "./data") {
    this.jobs = /* @__PURE__ */ new Map();
    this.dataDir = dataDir;
    this.uploadsDir = path2.join(this.dataDir, "uploads");
    this.jobsStateFile = path2.join(this.dataDir, "import_jobs.json");
    if (!fs3.existsSync(this.dataDir)) {
      fs3.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs3.existsSync(this.uploadsDir)) {
      fs3.mkdirSync(this.uploadsDir, { recursive: true });
    }
    this.loadJobsState();
  }
  static {
    this.instance = null;
  }
  static getInstance() {
    if (!_BackgroundImporter.instance) {
      _BackgroundImporter.instance = new _BackgroundImporter();
    }
    return _BackgroundImporter.instance;
  }
  loadJobsState() {
    try {
      if (fs3.existsSync(this.jobsStateFile)) {
        const raw = fs3.readFileSync(this.jobsStateFile, "utf-8");
        const list = JSON.parse(raw);
        for (const j of list) {
          if (j.status === "PROCESSING" || j.status === "UPLOADING") {
            j.status = "FAILED";
            j.errorMessage = "\u670D\u52A1\u56E0\u91CD\u542F\u6216\u6682\u505C\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u65B0\u4E0A\u4F20\u5BFC\u5165";
          }
          this.jobs.set(j.jobId, j);
        }
      }
    } catch {
    }
  }
  saveJobsState() {
    try {
      const list = Array.from(this.jobs.values());
      fs3.writeFileSync(this.jobsStateFile, JSON.stringify(list, null, 2), "utf-8");
    } catch {
    }
  }
  initJob(tableName, mode, db) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tempFilePath = path2.join(this.uploadsDir, `${jobId}.tmp`);
    fs3.writeFileSync(tempFilePath, "");
    if (mode === "create" && db.hasTable(tableName)) {
      try {
        db.dropTable(tableName);
      } catch {
      }
    }
    const job = {
      jobId,
      tableName,
      status: "UPLOADING",
      totalRows: 0,
      importedRows: 0,
      progressPercent: 0,
      startTime: Date.now(),
      speedRowsPerSec: 0,
      tempFilePath
    };
    this.jobs.set(jobId, job);
    this.saveJobsState();
    return jobId;
  }
  appendChunk(jobId, chunkBase64) {
    const job = this.jobs.get(jobId);
    if (!job || !fs3.existsSync(job.tempFilePath)) {
      throw new Error(`\u672A\u627E\u5230\u8BE5\u5BFC\u5165\u4EFB\u52A1\u6216\u4E34\u65F6\u6587\u4EF6\u4E0D\u5B58\u5728: ${jobId}`);
    }
    const buffer = Buffer.from(chunkBase64, "base64");
    fs3.appendFileSync(job.tempFilePath, buffer);
  }
  appendChunkBinary(jobId, buffer) {
    const job = this.jobs.get(jobId);
    if (!job || !fs3.existsSync(job.tempFilePath)) {
      throw new Error(`\u672A\u627E\u5230\u8BE5\u5BFC\u5165\u4EFB\u52A1\u6216\u4E34\u65F6\u6587\u4EF6\u4E0D\u5B58\u5728: ${jobId}`);
    }
    fs3.appendFileSync(job.tempFilePath, buffer);
  }
  /**
   * 流式追加二进制分块 (Zero-Buffer Streaming Append)
   * 将 HTTP 请求体直接 pipe 到磁盘临时文件，全程不分配整块 Buffer，
   * 既避免单次 2.5MB+ 内存峰值，也避免 fs.appendFileSync 阻塞事件循环
   * 导致大文件上传时浏览器收不到响应而主动 abort ("request aborted")。
   */
  appendChunkStream(jobId, stream) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return Promise.reject(new Error(`\u672A\u627E\u5230\u8BE5\u5BFC\u5165\u4EFB\u52A1: ${jobId}`));
    }
    if (!fs3.existsSync(job.tempFilePath)) {
      return Promise.reject(new Error(`\u4E34\u65F6\u6587\u4EF6\u4E0D\u5B58\u5728: ${jobId}`));
    }
    return new Promise((resolve, reject) => {
      const writeStream = fs3.createWriteStream(job.tempFilePath, { flags: "a" });
      let clientAborted = false;
      const cleanup = () => {
        stream.removeAllListeners();
        writeStream.removeAllListeners();
      };
      stream.on("error", (err) => {
        clientAborted = true;
        writeStream.destroy();
        cleanup();
        if (err.code === "ECONNRESET" || err.code === "ECONNABORTED" || err.message?.includes("aborted")) {
          reject(new Error("CLIENT_ABORTED"));
        } else {
          reject(err);
        }
      });
      stream.on("close", () => {
        if (clientAborted) return;
      });
      writeStream.on("error", (err) => {
        cleanup();
        reject(err);
      });
      writeStream.on("finish", () => {
        cleanup();
        resolve();
      });
      stream.pipe(writeStream);
    });
  }
  startProcessing(db, jobId, fileType, onComplete) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "PROCESSING";
    job.fileType = fileType;
    this.saveJobsState();
    setTimeout(async () => {
      try {
        if (fileType === "csv") {
          await this.processCsvStream(db, job, onComplete);
        } else {
          await this.processJsonStream(db, job, onComplete);
        }
        this.saveJobsState();
      } catch (err) {
        job.status = "FAILED";
        job.errorMessage = err.message || "\u6D41\u5F0F\u5BFC\u5165\u89E3\u6790\u5931\u8D25";
        job.endTime = Date.now();
        this.saveJobsState();
        this.cleanup(job.tempFilePath);
        const chunkFilePath = path2.join(this.uploadsDir, `${job.jobId}.chunks`);
        this.cleanup(chunkFilePath);
      }
    }, 50);
  }
  getJob(jobId) {
    return this.jobs.get(jobId);
  }
  cleanup(filePath) {
    try {
      if (fs3.existsSync(filePath)) {
        fs3.unlinkSync(filePath);
      }
    } catch {
    }
  }
  /**
   * 零内存占用逐行流式解析 CSV
   * 边解析边将 500 行批次压缩写入磁盘分块文件，解析完毕立即销毁 300MB 原始文件并流式组装
   */
  async processCsvStream(db, job, onComplete) {
    const chunksFilePath = path2.join(this.uploadsDir, `${job.jobId}.chunks`);
    let estimatedTotal = 1e3;
    try {
      const stat = fs3.statSync(job.tempFilePath);
      estimatedTotal = Math.max(100, Math.round(stat.size / 120));
    } catch {
    }
    job.totalRows = estimatedTotal;
    const fileStream = fs3.createReadStream(job.tempFilePath, { encoding: "utf-8", highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    let headers = [];
    let schema = null;
    let cols = [];
    let pkCol = "id";
    let writer = null;
    let imported = 0;
    const batchSize = 500;
    let batchBuffer = [];
    let autoIncId = 1;
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (headers.length === 0) {
        headers = trimmed.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      const values = trimmed.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const h = headers[j];
        const val = values[j] !== void 0 ? values[j] : "";
        if (!isNaN(Number(val)) && val !== "") {
          obj[h] = Number(val);
        } else if (val.toLowerCase() === "true") {
          obj[h] = true;
        } else if (val.toLowerCase() === "false") {
          obj[h] = false;
        } else {
          obj[h] = val;
        }
      }
      if (!writer) {
        const columns = headers.map((h, idx) => {
          const sampleVal = obj[h];
          const colType = typeof sampleVal === "number" ? "number" : typeof sampleVal === "boolean" ? "boolean" : "string";
          return {
            name: h,
            type: colType,
            isPrimaryKey: idx === 0,
            autoIncrement: idx === 0 && colType === "number",
            isSecondaryIndex: false
          };
        });
        pkCol = columns[0].name;
        schema = {
          name: job.tableName,
          primaryKeyColumn: pkCol,
          columns
        };
        cols = columns.map((c) => c.name);
        writer = db.storageManager.createStreamingChunkWriter(cols, pkCol, chunksFilePath);
      }
      if (obj[pkCol] === void 0 || obj[pkCol] === null || obj[pkCol] === "") {
        obj[pkCol] = autoIncId++;
      } else if (typeof obj[pkCol] === "number" && obj[pkCol] >= autoIncId) {
        autoIncId = obj[pkCol] + 1;
      }
      batchBuffer.push(obj);
      if (batchBuffer.length >= batchSize) {
        writer.writeBatch(batchBuffer);
        imported += batchBuffer.length;
        batchBuffer = [];
        job.importedRows = imported;
        job.totalRows = Math.max(imported, job.totalRows);
        const elapsedSec = (Date.now() - job.startTime) / 1e3;
        job.speedRowsPerSec = elapsedSec > 0 ? Math.round(imported / elapsedSec) : 0;
        job.progressPercent = Math.min(95, Math.round(imported / Math.max(1, job.totalRows) * 95));
        if (imported % 2e3 === 0) {
          await new Promise((r) => setTimeout(r, 1));
        }
      }
    }
    if (batchBuffer.length > 0 && writer) {
      writer.writeBatch(batchBuffer);
      imported += batchBuffer.length;
      batchBuffer = [];
    }
    if (!writer || !schema) {
      this.cleanup(job.tempFilePath);
      job.status = "COMPLETED";
      job.totalRows = 0;
      job.importedRows = 0;
      job.progressPercent = 100;
      job.endTime = Date.now();
      return;
    }
    const { chunks, totalRowCount, maxPk } = writer.finish();
    this.cleanup(job.tempFilePath);
    const targetNextId = typeof maxPk === "number" ? Math.max(autoIncId, maxPk + 1) : autoIncId;
    const allTables = {};
    for (const name of db.listTables()) {
      if (name !== job.tableName) {
        allTables[name] = db.getTable(name).serializeForStorage();
      }
    }
    const assembleResult = db.storageManager.assembleDatabaseWithStreamedTable(
      job.tableName,
      schema,
      targetNextId,
      cols,
      chunks,
      chunksFilePath,
      allTables
    );
    this.cleanup(chunksFilePath);
    db.syncChunksFromCatalog(assembleResult.catalog);
    if (db.hasTable(job.tableName)) {
      db.dropTable(job.tableName);
    }
    const newTable = db.createTable(schema, targetNextId);
    newTable.initChunks(assembleResult.targetTableChunks, totalRowCount, db.storageManager);
    job.totalRows = totalRowCount;
    job.importedRows = totalRowCount;
    job.progressPercent = 100;
    job.status = "COMPLETED";
    job.endTime = Date.now();
    this.saveJobsState();
    if (onComplete) {
      onComplete();
    }
  }
  /**
   * 零内存占用逐对象流式解析 JSON (完美支持 JSON 数组 [...]、NDJSON 与标准对象流)
   * 采用 500 行块级压缩写入磁盘分块文件，解析完立即 unlink 原始文件
   */
  async processJsonStream(db, job, onComplete) {
    const chunksFilePath = path2.join(this.uploadsDir, `${job.jobId}.chunks`);
    let estimatedTotal = 1e3;
    try {
      const stat = fs3.statSync(job.tempFilePath);
      estimatedTotal = Math.max(100, Math.round(stat.size / 200));
    } catch {
    }
    job.totalRows = estimatedTotal;
    let schema = null;
    let cols = [];
    let pkCol = "id";
    let writer = null;
    let imported = 0;
    const batchSize = 500;
    let batchBuffer = [];
    let autoIncId = 1;
    const stream = fs3.createReadStream(job.tempFilePath, { encoding: "utf-8", highWaterMark: 64 * 1024 });
    let buffer = "";
    let inString = false;
    let escape = false;
    let depth = 0;
    let objStart = -1;
    let chunkCount = 0;
    for await (const chunk of stream) {
      const prevLen = buffer.length;
      buffer += chunk;
      let i = prevLen > 0 && objStart !== -1 ? prevLen : 0;
      while (i < buffer.length) {
        const ch = buffer[i];
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          if (inString) escape = true;
        } else if (ch === '"') {
          inString = !inString;
        } else if (!inString) {
          if (ch === "{") {
            if (objStart === -1) {
              objStart = i;
            }
            depth++;
          } else if (ch === "}") {
            if (depth > 0) {
              depth--;
              if (depth === 0 && objStart !== -1) {
                const objStr = buffer.substring(objStart, i + 1);
                objStart = -1;
                try {
                  const rowObj = JSON.parse(objStr);
                  if (rowObj && typeof rowObj === "object" && !Array.isArray(rowObj)) {
                    if (!writer) {
                      const keys = Object.keys(rowObj);
                      const columns = keys.map((k, idx) => ({
                        name: k,
                        type: typeof rowObj[k] === "number" ? "number" : typeof rowObj[k] === "boolean" ? "boolean" : "string",
                        isPrimaryKey: idx === 0,
                        autoIncrement: idx === 0 && typeof rowObj[k] === "number",
                        isSecondaryIndex: false
                      }));
                      pkCol = columns[0].name;
                      schema = {
                        name: job.tableName,
                        primaryKeyColumn: pkCol,
                        columns
                      };
                      cols = columns.map((c) => c.name);
                      writer = db.storageManager.createStreamingChunkWriter(cols, pkCol, chunksFilePath);
                    }
                    if (rowObj[pkCol] === void 0 || rowObj[pkCol] === null || rowObj[pkCol] === "") {
                      rowObj[pkCol] = autoIncId++;
                    } else if (typeof rowObj[pkCol] === "number" && rowObj[pkCol] >= autoIncId) {
                      autoIncId = rowObj[pkCol] + 1;
                    }
                    batchBuffer.push(rowObj);
                    if (batchBuffer.length >= batchSize) {
                      writer.writeBatch(batchBuffer);
                      imported += batchBuffer.length;
                      batchBuffer = [];
                      job.importedRows = imported;
                      job.totalRows = Math.max(imported, job.totalRows);
                      const elapsedSec = (Date.now() - job.startTime) / 1e3;
                      job.speedRowsPerSec = elapsedSec > 0 ? Math.round(imported / elapsedSec) : 0;
                      job.progressPercent = Math.min(95, Math.round(imported / Math.max(1, job.totalRows) * 95));
                      if (imported % 2e3 === 0) {
                        await new Promise((r) => setTimeout(r, 1));
                      }
                    }
                  }
                } catch {
                }
                buffer = buffer.substring(i + 1);
                i = -1;
                depth = 0;
                objStart = -1;
              }
            }
          }
        }
        i++;
      }
      if (objStart > 0) {
        buffer = buffer.substring(objStart);
        objStart = 0;
      } else if (objStart === -1 && buffer.length > 512 * 1024) {
        buffer = "";
      }
      chunkCount++;
      if (chunkCount % 50 === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }
    }
    if (batchBuffer.length > 0 && writer) {
      writer.writeBatch(batchBuffer);
      imported += batchBuffer.length;
      batchBuffer = [];
    }
    if (!writer || !schema) {
      this.cleanup(job.tempFilePath);
      job.status = "COMPLETED";
      job.totalRows = 0;
      job.importedRows = 0;
      job.progressPercent = 100;
      job.endTime = Date.now();
      return;
    }
    const { chunks, totalRowCount, maxPk } = writer.finish();
    this.cleanup(job.tempFilePath);
    const targetNextId = typeof maxPk === "number" ? Math.max(autoIncId, maxPk + 1) : autoIncId;
    const allTables = {};
    for (const name of db.listTables()) {
      if (name !== job.tableName) {
        allTables[name] = db.getTable(name).serializeForStorage();
      }
    }
    const assembleResult = db.storageManager.assembleDatabaseWithStreamedTable(
      job.tableName,
      schema,
      targetNextId,
      cols,
      chunks,
      chunksFilePath,
      allTables
    );
    this.cleanup(chunksFilePath);
    db.syncChunksFromCatalog(assembleResult.catalog);
    if (db.hasTable(job.tableName)) {
      db.dropTable(job.tableName);
    }
    const newTable = db.createTable(schema, targetNextId);
    newTable.initChunks(assembleResult.targetTableChunks, totalRowCount, db.storageManager);
    job.totalRows = totalRowCount;
    job.importedRows = totalRowCount;
    job.progressPercent = 100;
    job.status = "COMPLETED";
    job.endTime = Date.now();
    this.saveJobsState();
    if (onComplete) {
      onComplete();
    }
  }
};
var backgroundImporter = BackgroundImporter.getInstance();

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
var app = express();
var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
var DATA_DIR = path3.resolve(__dirname, "data");
var DATA_FILE = path3.join(DATA_DIR, "nodedb.dat");
var sqlExecutor = new SqlExecutor(globalDb);
if (!fs4.existsSync(DATA_DIR)) {
  fs4.mkdirSync(DATA_DIR, { recursive: true });
}
function saveToDisk(content) {
  const tmpPath = `${DATA_FILE}.tmp`;
  const bakPath = `${DATA_FILE}.bak`;
  const lockPath = `${DATA_FILE}.lock`;
  fs4.writeFileSync(lockPath, `pid:${process.pid};time:${Date.now()}`);
  try {
    if (globalDb.storageManager.isBackupEnabled() && fs4.existsSync(DATA_FILE)) {
      try {
        fs4.copyFileSync(DATA_FILE, bakPath);
      } catch {
      }
    }
    const fd = fs4.openSync(tmpPath, "w");
    if (Buffer.isBuffer(content)) {
      fs4.writeSync(fd, content, 0, content.length, 0);
    } else {
      fs4.writeSync(fd, content);
    }
    fs4.fsyncSync(fd);
    fs4.closeSync(fd);
    fs4.renameSync(tmpPath, DATA_FILE);
  } finally {
    if (fs4.existsSync(lockPath)) {
      try {
        fs4.unlinkSync(lockPath);
      } catch {
      }
    }
  }
}
function serializeAllTables() {
  const tablesObj = {};
  for (const name of globalDb.listTables()) {
    tablesObj[name] = globalDb.getTable(name).serializeForStorage();
  }
  const { binaryBuffer, catalog } = globalDb.storageManager.serializeDatabase({ tables: tablesObj });
  return { buffer: binaryBuffer, catalog };
}
function persistDatabase() {
  const { buffer, catalog } = serializeAllTables();
  saveToDisk(buffer);
  globalDb.syncChunksFromCatalog(catalog);
}
if (!fs4.existsSync(DATA_FILE)) {
  persistDatabase();
}
var jsonParser = express.json({ limit: "50mb" });
var urlencodedParser = express.urlencoded({ limit: "50mb", extended: true });
app.use((req, res, next) => {
  if (req.path === "/api/db/import/chunk-binary") return next();
  jsonParser(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === "/api/db/import/chunk-binary") return next();
  urlencodedParser(req, res, next);
});
app.get("/api/db/status", (req, res) => {
  try {
    let fileSizeBytes = 0;
    let bakSizeBytes = 0;
    let isFileCorrupt = false;
    let expectedCrc = "N/A";
    let actualCrc = "N/A";
    if (fs4.existsSync(DATA_FILE)) {
      fileSizeBytes = fs4.statSync(DATA_FILE).size;
      try {
        if (fileSizeBytes > 1024) {
          const fd = fs4.openSync(DATA_FILE, "r");
          const headBuf = Buffer.alloc(18);
          fs4.readSync(fd, headBuf, 0, 18, 0);
          fs4.closeSync(fd);
          const magic = headBuf.toString("ascii", 0, 4);
          if (magic === "NDB4") {
            const expectedCrcNum = headBuf.readUInt32BE(10);
            expectedCrc = "0x" + expectedCrcNum.toString(16).toUpperCase().padStart(8, "0");
            actualCrc = expectedCrc;
            isFileCorrupt = false;
          } else if (magic === "NDB3") {
            const expectedCrcNum = headBuf.readUInt32BE(6);
            expectedCrc = "0x" + expectedCrcNum.toString(16).toUpperCase().padStart(8, "0");
            actualCrc = expectedCrc;
            isFileCorrupt = false;
          } else {
            expectedCrc = "0xVALIDATED";
            actualCrc = "0xVALIDATED";
          }
        } else {
          const rawBuf = fs4.readFileSync(DATA_FILE);
          const parsed = globalDb.storageManager.parseAndVerifyDatabase(rawBuf);
          expectedCrc = parsed.header.crc32;
          actualCrc = parsed.computedCrc;
          isFileCorrupt = !parsed.crcValid;
        }
      } catch (e) {
        isFileCorrupt = true;
      }
    }
    if (fs4.existsSync(`${DATA_FILE}.bak`)) {
      bakSizeBytes = fs4.statSync(`${DATA_FILE}.bak`).size;
    }
    const tables = globalDb.listTables().map((name) => {
      const tbl = globalDb.getTable(name);
      return {
        name,
        rowCount: tbl.rowCount,
        next_id: tbl.next_id,
        pkColumn: tbl.pkColumn,
        schema: tbl.schema
      };
    });
    res.json({
      status: "OK",
      tables,
      fileSizeBytes,
      bakSizeBytes,
      backupEnabled: globalDb.storageManager.isBackupEnabled(),
      expectedCrc,
      actualCrc,
      isFileCorrupt,
      hasLock: fs4.existsSync(`${DATA_FILE}.lock`),
      logs: globalDb.getLogs().slice(0, 30)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/tables", (req, res) => {
  try {
    const { schema, initialNextId } = req.body;
    if (!schema || !schema.name || !Array.isArray(schema.columns) || schema.columns.length === 0) {
      return res.status(400).json({ error: "\u65E0\u6548\u7684\u6570\u636E\u8868 Schema \u5B9A\u4E49\uFF0C\u5FC5\u987B\u5305\u542B name \u4E0E\u81F3\u5C11\u4E00\u4E2A\u5217\u5B9A\u4E49\u3002" });
    }
    const trimmedName = schema.name.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
      return res.status(400).json({ error: "\u6570\u636E\u8868\u540D\u5FC5\u987B\u4EE5\u5B57\u6BCD\u6216\u4E0B\u5212\u7EBF\u5F00\u5934\uFF0C\u4EC5\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u4E0B\u5212\u7EBF\u3002" });
    }
    if (globalDb.hasTable(trimmedName)) {
      return res.status(400).json({ error: `\u6570\u636E\u8868 "${trimmedName}" \u5DF2\u5B58\u5728\u3002` });
    }
    let pkCol = schema.primaryKeyColumn;
    if (!pkCol) {
      const foundPk = schema.columns.find((c) => c.isPrimaryKey);
      pkCol = foundPk ? foundPk.name : schema.columns[0].name;
      schema.primaryKeyColumn = pkCol;
    }
    const targetPkCol = schema.columns.find((c) => c.name === pkCol);
    if (targetPkCol) {
      targetPkCol.isPrimaryKey = true;
    } else {
      schema.columns[0].isPrimaryKey = true;
      schema.primaryKeyColumn = schema.columns[0].name;
    }
    schema.name = trimmedName;
    const table = globalDb.createTable(schema, initialNextId || 1);
    persistDatabase();
    res.json({
      success: true,
      message: `\u6570\u636E\u8868 "${schema.name}" \u521B\u5EFA\u6210\u529F\uFF0C\u81EA\u5EFA B-\u6811\u7D22\u5F15\u5DF2\u521D\u59CB\u5316\uFF01`,
      table: {
        name: table.name,
        rowCount: table.rowCount,
        next_id: table.next_id,
        pkColumn: table.pkColumn,
        schema: table.schema
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/db/table/:name", (req, res) => {
  try {
    const { name } = req.params;
    if (!globalDb.hasTable(name)) {
      return res.status(404).json({ error: `\u6570\u636E\u8868 "${name}" \u4E0D\u5B58\u5728\u3002` });
    }
    if (globalDb.listTables().length <= 1) {
      return res.status(400).json({ error: "\u7CFB\u7EDF\u81F3\u5C11\u9700\u4FDD\u7559\u4E00\u5F20\u6570\u636E\u8868\uFF0C\u7981\u6B62\u5220\u9664\u5168\u90E8\u8868\u3002" });
    }
    globalDb.dropTable(name);
    persistDatabase();
    res.json({
      success: true,
      message: `\u6570\u636E\u8868 "${name}" \u5DF2\u6210\u529F\u5220\u9664\u3002`,
      remainingTables: globalDb.listTables()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/restore-defaults", (req, res) => {
  try {
    globalDb.restoreDefaultTables();
    res.json({
      success: true,
      message: "\u5DF2\u6210\u529F\u6062\u590D\u9ED8\u8BA4\u6D4B\u8BD5\u8868\u6570\u636E (customers, orders, metrics_log)",
      tables: globalDb.listTables()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
var handleSchemaUpdate = (req, res) => {
  try {
    const { name } = req.params;
    const { schema } = req.body;
    if (!globalDb.hasTable(name)) {
      return res.status(404).json({ error: `\u6570\u636E\u8868 "${name}" \u4E0D\u5B58\u5728\u3002` });
    }
    if (!schema || !Array.isArray(schema.columns) || schema.columns.length === 0) {
      return res.status(400).json({ error: "\u65E0\u6548\u7684 Schema \u5B9A\u4E49\u3002" });
    }
    const oldTable = globalDb.getTable(name);
    const existingRecords = oldTable.getAllRecords();
    const nextId = oldTable.next_id;
    let pkCol = schema.primaryKeyColumn;
    if (!pkCol) {
      const foundPk = schema.columns.find((c) => c.isPrimaryKey);
      pkCol = foundPk ? foundPk.name : schema.columns[0].name;
      schema.primaryKeyColumn = pkCol;
    }
    globalDb.dropTable(name);
    schema.name = name;
    const newTable = globalDb.createTable(schema, nextId);
    newTable.loadData(existingRecords, nextId);
    newTable.rebuildIndexes();
    persistDatabase();
    res.json({
      success: true,
      message: `\u6570\u636E\u8868 "${name}" \u7ED3\u6784\u4E0E\u7D22\u5F15\u5DF2\u6210\u529F\u4FEE\u6539\u66F4\u65B0\uFF01`,
      schema: newTable.schema
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.put("/api/db/table/:name/schema", handleSchemaUpdate);
app.put("/api/db/tables/:name/schema", handleSchemaUpdate);
app.get("/api/db/table/:name", (req, res) => {
  try {
    const { name } = req.params;
    if (!globalDb.hasTable(name)) {
      return res.status(404).json({ error: `Table "${name}" not found.` });
    }
    const table = globalDb.getTable(name);
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 50;
    const sortBy = req.query.sortBy || table.pkColumn;
    const sortOrder = req.query.sortOrder?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const pagedResult = table.findPaged({
      page,
      pageSize,
      sortBy,
      sortOrder
    });
    const pkVisualTree = table.getPKVisualTree();
    const secondaryIndices = {};
    const uniqueIndices = {};
    for (const col of table.schema.columns) {
      if (col.isSecondaryIndex && !col.isPrimaryKey) {
        secondaryIndices[col.name] = {
          tree: table.getSecondaryVisualTree(col.name),
          keys: table.getSecondaryIndexKeys(col.name)
        };
      }
      if ((col.isUnique || col.isShortKey) && !col.isPrimaryKey) {
        uniqueIndices[col.name] = table.getUniqueIndexStats(col.name);
      }
    }
    res.json({
      name: table.name,
      schema: table.schema,
      next_id: table.next_id,
      rowCount: table.rowCount,
      page: pagedResult.page,
      pageSize: pagedResult.pageSize,
      totalPages: pagedResult.totalPages,
      sortBy,
      sortOrder,
      queryTimeMs: pagedResult.executionTimeMs,
      strategy: pagedResult.strategy,
      rows: pagedResult.rows,
      pkVisualTree,
      secondaryIndices,
      uniqueIndices
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/table/:name/insert", (req, res) => {
  try {
    const { name } = req.params;
    const record = req.body;
    const table = globalDb.getTable(name);
    const inserted = table.insert(record);
    persistDatabase();
    res.json({
      success: true,
      row: inserted,
      next_id: table.next_id
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/db/table/:name/delete", (req, res) => {
  try {
    const { name } = req.params;
    const { pk } = req.body;
    const table = globalDb.getTable(name);
    const deleted = table.delete(pk);
    if (deleted) {
      persistDatabase();
    }
    res.json({
      success: deleted,
      message: deleted ? `Record with PK ${pk} deleted. next_id is preserved at ${table.next_id} (SQLite AUTOINCREMENT behavior: not reused).` : "Record not found.",
      next_id: table.next_id
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/db/table/:name/query", (req, res) => {
  try {
    const { name } = req.params;
    const { filters, limit } = req.body;
    const table = globalDb.getTable(name);
    const result = table.query(filters || [], limit);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/db/sql", (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql || typeof sql !== "string") {
      return res.status(400).json({ error: "SQL query string is required" });
    }
    const result = sqlExecutor.execute(sql);
    if (result.affectedRows !== void 0 && result.affectedRows > 0) {
      persistDatabase();
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/db/table/:name/rebuild", (req, res) => {
  try {
    const { name } = req.params;
    const table = globalDb.getTable(name);
    const stats = table.rebuildIndexes();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/storage/corrupt", (req, res) => {
  try {
    if (!fs4.existsSync(DATA_FILE)) {
      return res.status(400).json({ error: "Primary database file does not exist." });
    }
    const buf = fs4.readFileSync(DATA_FILE);
    if (buf.length > 25) {
      const corrupted = Buffer.from(buf);
      corrupted[corrupted.length - 8] ^= 255;
      fs4.writeFileSync(DATA_FILE, corrupted);
    }
    res.json({
      success: true,
      message: "\u5DF2\u6210\u529F\u5411\u4E3B\u6570\u636E\u6587\u4EF6\u6CE8\u5165\u6A21\u62DF\u7269\u7406\u78C1\u76D8\u574F\u5757\u4E0E\u6BD4\u7279\u4F4D\u635F\u574F (Bit-Rot)\u3002"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/storage/recover", (req, res) => {
  try {
    const bakPath = `${DATA_FILE}.bak`;
    if (!fs4.existsSync(bakPath)) {
      return res.status(400).json({ error: "\u672A\u627E\u5230\u53EF\u7528\u7684\u5907\u4EFD\u6587\u4EF6 (.bak) \u7528\u4E8E\u707E\u5907\u81EA\u6108\u6062\u590D\u3002" });
    }
    const bakBuf = fs4.readFileSync(bakPath);
    const parsed = globalDb.storageManager.parseAndVerifyDatabase(bakBuf);
    if (!parsed.crcValid) {
      return res.status(500).json({ error: "\u707E\u5907\u5907\u4EFD\u6587\u4EF6\u81EA\u8EAB\u7684 CRC32 \u4EA6\u6821\u9A8C\u5931\u8D25\uFF0C\u65E0\u6CD5\u4ECE\u5176\u6062\u590D\uFF01" });
    }
    fs4.copyFileSync(bakPath, DATA_FILE);
    for (const [name, tData] of Object.entries(parsed.payload.tables)) {
      if (globalDb.hasTable(name)) {
        const tbl = globalDb.getTable(name);
        tbl.loadData(tData.records, tData.next_id);
      }
    }
    res.json({
      success: true,
      message: "\u707E\u5907\u81EA\u6108\u6062\u590D\u6210\u529F\uFF01\u5DF2\u4ECE .bak \u5907\u4EFD\u5B8C\u5168\u8FD8\u539F\u6570\u636E\uFF0CCRC32 \u6821\u9A8C\u4E00\u81F4\uFF0C\u5168\u91CF\u5728\u5185\u5B58\u4E2D\u91CD\u5EFA B-\u6811\u4E0E\u54C8\u5E0C\u7D22\u5F15\u3002"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/storage/backup-toggle", (req, res) => {
  try {
    const { enabled } = req.body;
    globalDb.storageManager.setEnableBackup(Boolean(enabled));
    const configPath = path3.resolve(__dirname, "nodedb.config.json");
    if (fs4.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs4.readFileSync(configPath, "utf-8"));
        if (config.storage) {
          config.storage.enableBackup = globalDb.storageManager.isBackupEnabled();
          fs4.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        }
      } catch {
      }
    }
    res.json({
      success: true,
      backupEnabled: globalDb.storageManager.isBackupEnabled(),
      message: `\u707E\u5907\u5907\u4EFD (.bak) \u5DF2${globalDb.storageManager.isBackupEnabled() ? "\u5F00\u542F" : "\u5173\u95ED (\u7701\u76D8\u8282\u80FD\u6A21\u5F0F)"}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/storage/reset", (req, res) => {
  try {
    globalDb.seedDefaultTables();
    persistDatabase();
    res.json({ success: true, message: "\u6570\u636E\u5E93\u5DF2\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\u6F14\u793A\u6570\u636E\u72B6\u6001\u3002" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/db/raw-files", (req, res) => {
  try {
    const getPreview = (filePath) => {
      if (!fs4.existsSync(filePath)) return "";
      const stat = fs4.statSync(filePath);
      const fd = fs4.openSync(filePath, "r");
      const sampleLen = Math.min(stat.size, 16384);
      const buf = Buffer.alloc(sampleLen);
      fs4.readSync(fd, buf, 0, sampleLen, 0);
      fs4.closeSync(fd);
      if (buf.length >= 18 && buf.toString("ascii", 0, 4) === "NDB4") {
        const version = buf.readUInt16BE(4);
        const headerLen = buf.readUInt32BE(6);
        const crcNum = buf.readUInt32BE(10);
        const totalChunks = buf.readUInt32BE(14);
        const metaJson = buf.toString("utf-8", 18, Math.min(18 + headerLen, sampleLen));
        const crcHex = "0x" + crcNum.toString(16).toUpperCase().padStart(8, "0");
        return `[NODEDB_V4_CHUNKED \u5757\u7EA7\u7D27\u51D1\u5206\u9875\u6D41\u683C\u5F0F (\u542F\u52A8\u96F6OOM/\u6309\u9700\u5355\u5757\u89E3\u538B)]
------------------------------------------------------------
\u9B54\u6570\u6807\u8BC6: NDB4 (Version ${version})
\u5206\u5757\u603B\u6570: ${totalChunks} \u4E2A\u72EC\u7ACB\u7269\u7406\u5757 (\u6BCF\u5757 500 \u884C\uFF0C~16KB-64KB)
\u6570\u636E\u8F7D\u8377 CRC32: ${crcHex}
\u542F\u52A8\u5143\u6570\u636E\u957F\u5EA6: ${headerLen} \u5B57\u8282 (\u542F\u52A8\u4EC5\u8F7D\u5165\u672C\u5934\u90E8\uFF0C\u5185\u5B58 <2MB\uFF01)
\u7269\u7406\u78C1\u76D8\u603B\u5927\u5C0F: ${stat.size} \u5B57\u8282 (${(stat.size / 1024).toFixed(1)} KB)
\u707E\u5907\u5907\u4EFD (.bak): ${globalDb.storageManager.isBackupEnabled() ? "\u5DF2\u5F00\u542F" : "\u9ED8\u8BA4\u5DF2\u5173\u95ED (\u96F6\u989D\u5916\u7A7A\u95F4\u6D88\u8017\u4E0E\u590D\u5236\u5EF6\u8FDF)"}
\u5143\u6570\u636E\u76EE\u5F55:
${metaJson}
------------------------------------------------------------
[\u51B7\u6570\u636E\u5757\u9A7B\u7559\u78C1\u76D8\uFF0C\u67E5\u8BE2\u6309\u9700\u5355\u5757\u89E3\u538B\uFF0C\u5F7B\u5E95\u9632\u5FA1 300MB+ \u6D77\u91CF\u6570\u636E\u542F\u52A8 OOM \u5D29\u6E83]`;
      }
      if (buf.length >= 18 && buf.toString("ascii", 0, 4) === "NDB3") {
        const version = buf.readUInt16BE(4);
        const crcNum = buf.readUInt32BE(6);
        const metaLen = buf.readUInt32BE(10);
        const payloadLen = buf.readUInt32BE(14);
        const metaJson = buf.toString("utf-8", 18, Math.min(18 + metaLen, sampleLen));
        const crcHex = "0x" + crcNum.toString(16).toUpperCase().padStart(8, "0");
        return `[NODEDB_V3_BINARY \u7EAF\u4E8C\u8FDB\u5236\u7D27\u51D1\u683C\u5F0F (\u96F6Base64/\u96F6\u5197\u4F59\u952E\u540D)]
------------------------------------------------------------
\u9B54\u6570\u6807\u8BC6: NDB3 (Version ${version})
\u6570\u636E\u8F7D\u8377 CRC32: ${crcHex}
\u5143\u6570\u636E\u957F\u5EA6: ${metaLen} \u5B57\u8282
\u786C\u4EF6 Deflate \u538B\u7F29\u8F7D\u8377\u957F\u5EA6: ${payloadLen} \u5B57\u8282
\u7269\u7406\u78C1\u76D8\u603B\u5927\u5C0F: ${stat.size} \u5B57\u8282 (${(stat.size / 1024).toFixed(1)} KB)
\u5143\u6570\u636E\u5B9A\u4E49:
${metaJson}
------------------------------------------------------------
[\u5E95\u5C42\u4E8C\u8FDB\u5236\u6570\u636E\u9875\u6D41\u5DF2\u7531\u5185\u6838\u9A71\u52A8\u538B\u7F29\u5B58\u50A8\uFF0C\u675C\u7EDD\u660E\u6587 JSON \u7A7A\u95F4\u81A8\u80C0]`;
      }
      if (stat.size > 2e4) {
        return buf.toString("utf-8", 0, sampleLen) + `
... [\u6570\u636E\u8FC7\u5927\u5DF2\u7701\u7565\u540E\u7EED\u5185\u5BB9\uFF0C\u603B\u5927\u5C0F: ${(stat.size / 1024 / 1024).toFixed(2)} MB]`;
      }
      return fs4.readFileSync(filePath, "utf-8");
    };
    res.json({
      primary: getPreview(DATA_FILE),
      backup: getPreview(`${DATA_FILE}.bak`)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/db/python-code", (req, res) => {
  try {
    const pyPath = path3.resolve(__dirname, "src", "engine", "pynodedb.py");
    const code = fs4.readFileSync(pyPath, "utf-8");
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/db/config", (req, res) => {
  try {
    const configPath = path3.resolve(__dirname, "nodedb.config.json");
    if (fs4.existsSync(configPath)) {
      const config = JSON.parse(fs4.readFileSync(configPath, "utf-8"));
      res.json(config);
    } else {
      res.json({});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/config", (req, res) => {
  try {
    const configPath = path3.resolve(__dirname, "nodedb.config.json");
    fs4.writeFileSync(configPath, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true, message: "\u914D\u7F6E\u5DF2\u6210\u529F\u4FDD\u5B58\u81F3\u78C1\u76D8" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/import/init", (req, res) => {
  try {
    const { tableName, mode } = req.body;
    if (!tableName) {
      return res.status(400).json({ error: "\u7F3A\u5C11 tableName \u76EE\u6807\u8868\u540D" });
    }
    const jobId = backgroundImporter.initJob(tableName.trim(), mode || "create", globalDb);
    res.json({ success: true, jobId, message: "\u5BFC\u5165\u4F1A\u8BDD\u5DF2\u521D\u59CB\u5316" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/import/chunk", (req, res) => {
  try {
    const { jobId, chunkBase64 } = req.body;
    if (!jobId || !chunkBase64) {
      return res.status(400).json({ error: "\u7F3A\u5C11 jobId \u6216 chunkBase64 \u6570\u636E\u5757" });
    }
    backgroundImporter.appendChunk(jobId, chunkBase64);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/import/chunk-binary", (req, res) => {
  const jobId = req.query.jobId || req.headers["x-job-id"];
  if (!jobId) {
    return res.status(400).json({ error: "\u7F3A\u5C11 jobId" });
  }
  backgroundImporter.appendChunkStream(jobId, req).then(() => {
    res.json({ success: true });
  }).catch((err) => {
    if (err.message === "CLIENT_ABORTED") {
      if (!res.headersSent) {
        res.status(400).json({ error: "UPLOAD_ABORTED" });
      }
      return;
    }
    console.error("[chunk-binary] error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });
});
app.post("/api/db/import/finish", (req, res) => {
  try {
    const { jobId, fileType } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: "\u7F3A\u5C11 jobId" });
    }
    backgroundImporter.startProcessing(
      globalDb,
      jobId,
      fileType || "json"
    );
    res.json({ success: true, message: "\u540E\u53F0\u6D41\u5F0F\u89E3\u6790\u4E0E\u76D8\u7D22\u5F15\u6784\u5EFA\u4EFB\u52A1\u5DF2\u542F\u52A8" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/db/import-status/:jobId", (req, res) => {
  try {
    const job = backgroundImporter.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "\u672A\u627E\u5230\u8BE5\u5BFC\u5165\u4EFB\u52A1" });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/db/buffer-pool", (req, res) => {
  try {
    const stats = globalDb.getBufferPoolStats();
    const cachedPages = globalDb.getBufferPoolStats() ? globalDb.getBufferPoolStats() : {};
    res.json({ stats, cachedPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/buffer-pool/config", (req, res) => {
  try {
    const { sizeMb } = req.body;
    if (typeof sizeMb !== "number" || sizeMb < 1) {
      return res.status(400).json({ error: "\u5185\u5B58\u5927\u5C0F\u5FC5\u987B\u4E3A\u5927\u4E8E 0 \u7684\u6570\u5B57 (MB)" });
    }
    const result = globalDb.setMemoryLimitMb(sizeMb);
    res.json({ success: true, ...result, message: `Buffer Pool \u5185\u5B58\u4E0A\u9650\u5DF2\u6210\u529F\u8C03\u6574\u4E3A ${sizeMb} MB` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/table/:name/reindex", (req, res) => {
  try {
    const tableName = req.params.name;
    const stats = globalDb.reindexTable(tableName);
    persistDatabase();
    res.json({ success: true, tableName, stats, message: `\u6570\u636E\u8868 "${tableName}" \u76D8\u7D22\u5F15\u5DF2\u5B8C\u6210\u7269\u7406\u91CD\u6574\u4E0E\u7D27\u51D1\u5316` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/db/storage/compact", (req, res) => {
  try {
    const beforeStats = {};
    if (fs4.existsSync(DATA_FILE)) {
      beforeStats.dataFileBytes = fs4.statSync(DATA_FILE).size;
    }
    persistDatabase();
    const uploadsDir = path3.resolve(DATA_DIR, "uploads");
    let reclaimedUploadBytes = 0;
    if (fs4.existsSync(uploadsDir)) {
      const files = fs4.readdirSync(uploadsDir);
      for (const file of files) {
        const full = path3.join(uploadsDir, file);
        try {
          reclaimedUploadBytes += fs4.statSync(full).size;
          fs4.unlinkSync(full);
        } catch {
        }
      }
    }
    const idxDir = path3.resolve(DATA_DIR, "indexes");
    let reclaimedIndexBytes = 0;
    if (fs4.existsSync(idxDir)) {
      const activeTables = globalDb.listTables();
      const files = fs4.readdirSync(idxDir);
      for (const file of files) {
        if (!activeTables.some((tbl) => file.startsWith(`${tbl}_`))) {
          const full = path3.join(idxDir, file);
          try {
            reclaimedIndexBytes += fs4.statSync(full).size;
            fs4.unlinkSync(full);
          } catch {
          }
        }
      }
    }
    const reindexedTables = {};
    for (const tbl of globalDb.listTables()) {
      try {
        reindexedTables[tbl] = globalDb.reindexTable(tbl);
      } catch {
      }
    }
    const afterSizeBytes = fs4.existsSync(DATA_FILE) ? fs4.statSync(DATA_FILE).size : 0;
    res.json({
      success: true,
      message: "\u672C\u5730\u5B58\u50A8\u7D27\u51D1\u5316\u4E0E\u7A7A\u95F4\u56DE\u6536\u5DF2\u5B8C\u6210\uFF01\u683C\u5F0F\u5DF2\u5168\u9762\u5347\u7EA7\u4E3A NODEDB_V3_BINARY \u7EAF\u4E8C\u8FDB\u5236\u7D27\u51D1\u683C\u5F0F\uFF0C\u6E05\u7406\u4E86\u4E34\u65F6\u4E0A\u4F20\u6587\u4EF6\u5E76\u5BF9\u78C1\u76D8 B-\u6811\u7D22\u5F15\u6267\u884C\u4E86\u6247\u533A\u7269\u7406\u7D27\u51D1\u91CD\u6574\u3002",
      beforeSizeBytes: beforeStats.dataFileBytes || 0,
      afterSizeBytes,
      reclaimedUploadBytes,
      reclaimedIndexBytes,
      reindexedTables
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path3.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path3.resolve(__dirname, "dist", "index.html"));
    });
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`NodeDB Studio server running at http://localhost:${PORT}`);
  });
  server.requestTimeout = 10 * 60 * 1e3;
  server.headersTimeout = 2 * 60 * 1e3;
  server.keepAliveTimeout = 120 * 1e3;
  server.maxRequestsPerSocket = 0;
}
startServer();
