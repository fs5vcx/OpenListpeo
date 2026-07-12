#!/usr/bin/env python3
"""从 entry-BvqgD7Tp.js (zh-CN) 提取翻译字典，拆分到 src/lang/zh-CN/*.json"""
import re
import json
import os
import sys
import shutil

SRC = '/tmp/fe-dist/extracted/assets/entry-BvqgD7Tp.js'
DST_DIR = '/workspace/OpenList-Frontend/src/lang/zh-CN'

with open(SRC, 'r', encoding='utf-8') as f:
    content = f.read()

m = re.search(r'var t=(\{.*?\})\s*;export\{t as dict\}', content, re.DOTALL)
if not m:
    # 尝试其他模式
    m = re.search(r'var t=(\{.*\})\s*;export\{t as dict\}', content, re.DOTALL)
if not m:
    m = re.search(r'var t=(\{.*\});', content, re.DOTALL)
if not m:
    print('未找到 var t={...}')
    sys.exit(1)

js_obj = m.group(1)
print(f'JS对象长度: {len(js_obj)}')

def convert_backticks(s):
    result = []
    i = 0
    while i < len(s):
        if s[i] == '`':
            j = i + 1
            while j < len(s):
                if s[j] == '\\' and j + 1 < len(s):
                    j += 2
                    continue
                if s[j] == '`':
                    break
                j += 1
            if j >= len(s):
                result.append(s[i:])
                break
            inner = s[i+1:j]
            inner = inner.replace('\\', '\\\\').replace('"', '\\"')
            inner = inner.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
            result.append('"' + inner + '"')
            i = j + 1
        else:
            result.append(s[i])
            i += 1
    return ''.join(result)

json_str = convert_backticks(js_obj)
json_str = re.sub(r'([{,])([a-zA-Z_][a-zA-Z0-9_]*):', r'\1"\2":', json_str)
# 处理数字 key（如 115:"115"）
json_str = re.sub(r'([{,])([0-9]+):', r'\1"\2":', json_str)
# 处理变量引用（如 "index":e）- 替换为空字典
json_str = re.sub(r'("[a-zA-Z_][a-zA-Z0-9_]*"):e([},])', r'\1:{}\2', json_str)
# 处理其他可能的变量引用（如 :e, :t 等）
json_str = re.sub(r'("[a-zA-Z_][a-zA-Z0-9_]*"):[a-zA-Z_][a-zA-Z0-9_]*([},])', r'\1:{}\2', json_str)

try:
    data = json.loads(json_str)
    print(f'解析成功，顶层 keys: {list(data.keys())}')
except json.JSONDecodeError as e:
    print(f'JSON 解析失败: {e}')
    with open('/tmp/debug.json', 'w', encoding='utf-8') as f:
        f.write(json_str)
    pos = e.pos
    print(f'错误位置附近: ...{json_str[max(0,pos-80):pos+80]}...')
    sys.exit(1)

os.makedirs(DST_DIR, exist_ok=True)

for key, value in data.items():
    if isinstance(value, dict):
        dst_file = os.path.join(DST_DIR, f'{key}.json')
        with open(dst_file, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
        print(f'写入 {key}.json: {len(value)} 个键')
    else:
        print(f'跳过非字典 key: {key}')

src_entry = '/workspace/OpenList-Frontend/src/lang/en/entry.ts'
dst_entry = os.path.join(DST_DIR, 'entry.ts')
shutil.copy2(src_entry, dst_entry)
print(f'复制 entry.ts')

print('完成!')
