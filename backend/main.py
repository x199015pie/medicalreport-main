from fastapi import FastAPI, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any
from weasyprint import HTML
from jinja2 import Environment, FileSystemLoader
import calendar
import io
import json
import pdfplumber
import asyncio
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

aclient = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

class Medication(BaseModel):
    name: Any = ""
    quantity: Any = ""
    time: Any = ""

class PatientInfo(BaseModel):
    patient_name: Any = "Unknown"
    dob: Any = "Unknown"
    medications: List[Medication] = []

class BulkMARRequest(BaseModel):
    year: Any = 2026
    month: Any = 1
    patients: List[PatientInfo] = []

env = Environment(loader=FileSystemLoader("templates"))

@app.post("/generate-mar")
async def generate_mar(data: BulkMARRequest):
    try:
        report_year = int(data.year)
        report_month = int(data.month)
    except:
        report_year = 2026
        report_month = 1

    _, num_days = calendar.monthrange(report_year, report_month)
    days_list = list(range(1, num_days + 1))
    
    time_order = {
        "Morning(0800)": 1,
        "Noon(1200)": 2,
        "Dinner(1700)": 3,
        "Evening(2100)": 4
    }
    
    for patient in data.patients:
        if patient.medications:
            patient.medications.sort(key=lambda med: time_order.get(str(med.time), 99))
    
    template = env.get_template("mar_template.html")
    rendered_html = template.render(
        year=report_year,
        month=report_month,
        days=days_list,
        patients=data.patients
    )
    
    pdf_bytes = HTML(string=rendered_html).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf")

async def fetch_page_data(page_index, extracted_data):
    # ✨ 終極修正版 Prompt：明確要求先抓藥名，再對齊時間
    prompt = f"""
    你是一個嚴格的醫療數據提取系統。目前正在處理第 {page_index+1} 頁的單一病患資料。
    
    【🚨 終極對齊破解：強制陣列索引對應法】
    因為這是一份多欄位的表格，你絕對不可以透過指示(Directions)裡的文字來猜測服用時間！
    請你嚴格執行以下步驟：

    步驟 1. 分析標題列：在 `表格結構 (2D Array)` 中，找出「藥物名稱(Drug Name)」的 Index，以及 "Morning", "Noon", "Dinner", "Evening" 這四個字眼分別位在第幾個 Index。
    步驟 2. 逐行掃描：針對每一行藥物，👉 **務必先完整抓取該列的「藥物名稱與劑量」** 👈，接著只檢查那四個時間 Index 欄位。
    步驟 3. 判定時間與數量：
       - 如果 Morning 所在的 Index 欄位有數字 (如 "1")，就建立一筆紀錄：名稱填入剛抓的藥名，數量為 "1"，時間為 "Morning(0800)"。
       - 如果 Evening 所在的 Index 欄位有數字 (如 "3")，就建立獨立紀錄：名稱填入同一行藥名，數量為 "3"，時間為 "Evening(2100)"。
       - 如果同一個藥物在多個時間欄位都有數字，**必須拆分成多筆獨立紀錄，且每一筆都必須帶有相同的「藥物名稱」！絕對不可以留空！**
    
    【基本提取規則】：
    0. 表單年月 (year, month)：找出處方籤的年份與月份，轉為數字 (1-12)。
    1. 姓名與生日：找出 Name 與 DOB。找不到請填 "Unknown"。
    2. 藥物名稱 (name)：絕對不能是空白！必須完整抓取。
    3. 數量格式：抓取到的數量必須是「純字串」(如 "1", "1/2")，絕對不要回傳陣列！
    4. 允許的時間選項：只有 "Morning(0800)", "Noon(1200)", "Dinner(1700)", "Evening(2100)"。
    
    需要的 JSON 結構必須完全長這樣：
    {{
        "year": 2026,
        "month": 2,
        "patients": [
            {{
                "patient_name": "病患姓名",
                "dob": "1950-01-01",
                "medications": [ ... ]
            }}
        ]
    }}
    
    待解析資料：
    {extracted_data}
    """

    response = await aclient.chat.completions.create(
        model="gpt-4o", 
        messages=[
            {"role": "system", "content": "You output only JSON and rely strictly on the 2D array column indexes for time and quantities. Never leave medication names blank."},
            {"role": "user", "content": prompt}
        ],
        response_format={ "type": "json_object" },
        temperature=0 
    )
    
    res_data = json.loads(response.choices[0].message.content)
    
    if "patients" in res_data:
        for p in res_data["patients"]:
            if "medications" in p:
                for m in p["medications"]:
                    # 防呆：時間校正
                    t = str(m.get("time", "")).lower()
                    if "morning" in t: m["time"] = "Morning(0800)"
                    elif "noon" in t: m["time"] = "Noon(1200)"
                    elif "dinner" in t: m["time"] = "Dinner(1700)"
                    elif "evening" in t or "bedtime" in t or "night" in t: m["time"] = "Evening(2100)"
                    else: m["time"] = "Morning(0800)" 
                    
                    # 防呆：數量校正
                    qty = m.get("quantity", "")
                    if isinstance(qty, list):
                        m["quantity"] = str(qty[0]) if qty else ""
                    else:
                        m["quantity"] = str(qty).replace("[", "").replace("]", "").replace("'", "").replace('"', "").strip()
                        
    return res_data

@app.post("/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    pdf_bytes = await file.read()
    
    async def generate_progress():
        try:
            all_patients = []
            common_year = None
            common_month = None
            
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                total_pages = len(pdf.pages)
                
                yield json.dumps({"status": "start", "total": total_pages}) + "\n"
                print(f"\n========== 開始處理 {total_pages} 頁資料 (使用 GPT-4o) ==========")
                
                for i, page in enumerate(pdf.pages):
                    print(f"⏳ 正在解析第 {i+1}/{total_pages} 頁...")
                    
                    extracted_data = ""
                    text_content = page.extract_text() or ""
                    extracted_data += f"--- Page {i+1} 基本文字 ---\n{text_content}\n\n"
                    
                    tables = page.extract_tables()
                    if tables:
                        for idx, table in enumerate(tables):
                            cleaned_table = []
                            for row in table:
                                cleaned_row = [str(cell).replace('\n', ' ').strip() if cell else "" for cell in row]
                                if any(cleaned_row):
                                    cleaned_table.append(cleaned_row)
                            extracted_data += f"--- Page {i+1} 表格結構 (2D Array) ---\n"
                            extracted_data += json.dumps(cleaned_table, ensure_ascii=False) + "\n\n"

                    max_retries = 8
                    for attempt in range(max_retries):
                        try:
                            res = await fetch_page_data(i, extracted_data)
                            if i == 0:
                                common_year = res.get("year")
                                common_month = res.get("month")
                            if "patients" in res:
                                all_patients.extend(res["patients"])
                            
                            print(f"✅ 第 {i+1} 頁解析成功！")
                            break 
                            
                        except Exception as e:
                            if "429" in str(e).lower() or "rate limit" in str(e).lower():
                                wait_time = 20 * (attempt + 1)
                                print(f"⚠️ 觸發頻率限制，等待額度釋放 {wait_time} 秒...")
                                yield json.dumps({"status": "waiting", "message": f"⏳ TPM 滿載，排隊等待釋放額度 ({wait_time} 秒)..."}) + "\n"
                                await asyncio.sleep(wait_time)
                            else:
                                print(f"❌ 第 {i+1} 頁發生未知錯誤: {e}")
                                break 
                    
                    yield json.dumps({"status": "progress", "current": i + 1, "total": total_pages}) + "\n"
                    
                    if i < total_pages - 1:
                        await asyncio.sleep(3.5)

            print(f"========== {total_pages} 頁資料合併完成 ==========\n")
            yield json.dumps({
                "status": "done",
                "result": {
                    "year": common_year,
                    "month": common_month,
                    "patients": all_patients
                }
            }) + "\n"

        except Exception as e:
            print(f"❌ 嚴重錯誤: {e}")
            yield json.dumps({"status": "error", "message": str(e)}) + "\n"

    return StreamingResponse(generate_progress(), media_type="application/x-ndjson")

