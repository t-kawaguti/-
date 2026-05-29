import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";
import ExcelJS from "exceljs";
import { Readable } from "stream";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json({ error: "Missing fileId parameter" }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ 
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string
    });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Google DriveからExcelファイルをストリームで取得
    const driveRes = await drive.files.get(
      { fileId: fileId, alt: "media" },
      { responseType: "stream" }
    );

    // streamをBufferに変換する
    const chunks: any[] = [];
    const stream = driveRes.data as Readable;
    
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", (err) => reject(err));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("現場記録");

    if (!sheet) {
      return NextResponse.json({ error: "Worksheet '現場記録' not found in Excel" }, { status: 404 });
    }

    const recordData: any = {};

    sheet.eachRow((row) => {
      const keyCell = row.getCell(1);
      const valCell = row.getCell(2);

      const key = keyCell.value?.toString().trim();
      let val = valCell.value;

      if (key && val !== undefined && val !== null) {
        if (typeof val === "object") {
          if ("text" in val) {
            val = (val as any).text;
          } else if ("hyperlink" in val) {
            val = (val as any).text;
          } else {
            val = val.toString();
          }
        }
        
        // 日本語のラベル名から英語のキー名へマッピング
        switch (key) {
          case "工事名":
            recordData.constructionName = val;
            break;
          case "請負会社名":
            recordData.contractorName = val;
            break;
          case "工事内容":
            recordData.details = val;
            break;
          case "工事記録":
            recordData.record = val;
            break;
          case "場所":
            recordData.address = val;
            break;
          case "緯度経度":
            if (val) {
              const parts = val.toString().split(",");
              if (parts.length === 2) {
                recordData.location = {
                  lat: parseFloat(parts[0]),
                  lng: parseFloat(parts[1]),
                };
              }
            }
            break;
          case "黒板タイプ":
            recordData.blackboardType = val === "図面・寸法入り黒板(大)" ? "large" : "standard";
            break;
          case "寸法":
            recordData.dimensions = val;
            break;
        }
      }
    });

    return NextResponse.json({ success: true, data: recordData });

  } catch (error: any) {
    console.error("Read Excel API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to read excel file" }, { status: 500 });
  }
}
