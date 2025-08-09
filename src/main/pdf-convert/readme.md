# 容器API说明
## 1. API 路径

- 路径: /file_parse
- 方法: POST
## 2. 功能描述

该 API 用于解析 PDF 文件，并根据请求参数返回相应的解析结果。支持多种解析选项，如输出目录、语言列表、解析方法等。
## 3. 请求参数
Content-Type: multipart/form-data

| 参数名 | 类型 | 必填 | 描述 |
|  ----  | ----  |---|---|
| files | array<string> | 是 |需要解析的 PDF 文件。文件类型必须为 .pdf。示例：@国内民营企业“软件工…实践经验与能力分析.pdf;type=application/pdf|
| output_dir | string | 否 | 输出目录路径，默认为 ./output。|
|lang_list|array<string>|否|语言列表，默认为 ['ch']。|
|backend|string|否|解析后端，填写 Pipeline。|parse_method|string|否|解析方法，默认为 auto。|
|formula_enable|boolean|否|是否启用公式解析，默认为 true。|table_enable|boolean|否|是否启用表格解析，默认为 true。|
|server_url|string|null|否|return_md|boolean|否|是否返回 Markdown 格式，默认为 true。|
|return_middle_json|boolean|否|是否返回中间 JSON 格式，默认为 false。|
|return_model_output|boolean|否|是否返回模型输出，默认为 false。|
|return_content_list|boolean|否|是否返回内容列表，默认为 false。|
|return_images|boolean|否|是否返回图片，默认为 false。|
|start_page_id|integer|否|开始页码，默认为 0。|
|end_page_id|integer|否|结束页码，默认为 99999。|
## 4. 请求示例
```
curl -X 'POST' \
  'http://100.86.150.80:8003/file_parse' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'return_middle_json=false' \
  -F 'return_model_output=false' \
  -F 'return_md=true' \
  -F 'return_images=false' \
  -F 'parse_method=auto' \
  -F 'start_page_id=0' \
  -F 'lang_list=ch' \
  -F 'output_dir=./output' \
  -F 'server_url=' \
  -F 'return_content_list=false' \
  -F 'backend=pipeline' \
  -F 'table_enable=true' \
  -F 'formula_enable=true' \
  -F 'files=@国内民营企业“软件工…实践经验与能力分析.pdf;type=application/pdf'
```