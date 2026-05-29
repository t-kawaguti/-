import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
import ExcelJS from "exceljs";
import { Readable } from "stream";

// Helper function to find or create a folder in Google Drive
async function getOrCreateFolder(drive: any, name: string, parentId: string = "root") {
  const query = `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`;
  const res = await drive.files.list({ q: query, fields: "files(id, name)" });
  
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  
  const created = await drive.files.create({
    requestBody: {
      name: name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return created.data.id;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Googleにログインしていません" }, { status: 401 });
    }

    const {
      images, // array of base64 strings
      constructionName,
      contractorName,
      details,
      record,
      location,
      address,
      saveFolderName,
      blackboardType,
      dimensions
    } = await req.json();

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ 
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string
    });
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");

    // === 1. Google Drive フォルダ階層の作成 ===
    // 階層: /電気仕事/工事記録/工事詳細(工事名)/YYYY/MM/
    const folderId1 = await getOrCreateFolder(drive, "電気仕事");
    const folderId2 = await getOrCreateFolder(drive, "工事記録", folderId1);
    
    const targetFolderName = saveFolderName ? saveFolderName.replace(/\//g, "_") : (constructionName ? constructionName.replace(/\//g, "_") : "名称未設定");
    const folderId3 = await getOrCreateFolder(drive, targetFolderName, folderId2);
    const folderIdYear = await getOrCreateFolder(drive, year, folderId3);
    const folderIdMonth = await getOrCreateFolder(drive, month, folderIdYear);

    // === 1.5 空のExcelファイルをDriveに作成してIDを取得 ===
    const safeConstructionName = constructionName ? constructionName.replace(/\//g, "_") : "名称未設定";
    const fileName = `${safeConstructionName}_${now.getTime()}.xlsx`;
    const createRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderIdMonth],
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      fields: "id, webViewLink",
    });
    const fileId = createRes.data.id;
    let fileLink = createRes.data.webViewLink;
    const baseUrl = process.env.NEXTAUTH_URL || "https://construction-camera-app.vercel.app";
    const editUrl = `${baseUrl}?editFileId=${fileId}`;

    // === 2. Excel (xlsx) の生成 ===
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("現場記録");

    // ヘッダー行
    sheet.addRow(["項目", "内容"]);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };

    // データ行 (計9行、ヘッダーと合わせて10行)
    sheet.addRow(["工事名", constructionName || ""]);
    sheet.addRow(["請負会社名", contractorName || ""]);
    sheet.addRow(["工事内容", details || ""]);
    sheet.addRow(["工事記録", record || ""]);
    sheet.addRow(["場所", address || (location ? `${location.lat},${location.lng}` : "未取得")]);
    sheet.addRow(["緯度経度", location ? `${location.lat},${location.lng}` : ""]);
    sheet.addRow(["黒板タイプ", blackboardType === "large" ? "図面・寸法入り黒板(大)" : "標準黒板"]);
    sheet.addRow(["寸法", dimensions || ""]);
    sheet.addRow(["日時", now.toLocaleString("ja-JP")]);

    // 11行目に再編集リンクを配置 (A11:E11を結合)
    sheet.getCell('A11').value = {
      text: '➔ この現場記録をアプリで再編集する',
      hyperlink: editUrl,
      tooltip: 'アプリを開いてこのデータを再編集します'
    };
    sheet.getCell('A11').font = {
      color: { argb: 'FF0000FF' },
      underline: true,
      bold: true,
      size: 11
    };
    sheet.mergeCells('A11:E11');
    sheet.getCell('A11').alignment = { horizontal: 'center', vertical: 'middle' };

    // 罫線と折り返し設定
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' },
          bottom: { style: 'thin' }, right: { style: 'thin' }
        };
        cell.alignment = { wrapText: true, vertical: 'middle' };
      });
      if (rowNumber > 1) {
        if (rowNumber === 11) {
          row.height = 25;
        } else {
          row.height = 30;
        }
      }
    });

    // 写真の埋め込み (imagesが存在する場合)
    if (images && images.length > 0) {
      images.forEach((imgBase64: string, index: number) => {
        const base64Data = imgBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageId = workbook.addImage({
          base64: base64Data,
          extension: 'jpeg',
        });
        
        // 縦に並べる:
        // 1枚目: B13:E35
        // 2枚目: B37:E59
        // ...
        const startRow = 13 + (index * 24);
        const endRow = startRow + 22;
        const range = `B${startRow}:E${endRow}`;
        
        sheet.addImage(imageId, range);
      });
    }

    // 列幅の自動調整ロジック（A列とB列のみ、改行考慮）
    sheet.columns.forEach((column, colIndex) => {
      if (colIndex > 1) return; // A列(0)とB列(1)のみ幅を調整
      let maxColumnLength = 0;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        // 再編集リンク（11行目）は結合セルのため幅計算から除外
        if (Number(cell.row) === 11) return;

        let cellLength = 0;
        if (cell.value) {
          let valStr = "";
          if (typeof cell.value === 'object') {
            if ('text' in cell.value) {
              valStr = (cell.value as any).text || "";
            } else if ('hyperlink' in cell.value) {
              valStr = (cell.value as any).text || "";
            }
          } else {
            valStr = cell.value.toString();
          }

          // 改行で分割し、最も長い行の長さを計測
          const lines = valStr.split(/\r?\n/);
          lines.forEach((line) => {
            const lineLength = Array.from(line).reduce((acc: number, char: any) => {
              return acc + (char.charCodeAt(0) > 127 ? 2 : 1);
            }, 0);
            if (lineLength > cellLength) {
              cellLength = lineLength;
            }
          });
        }
        if (cellLength > maxColumnLength) {
          maxColumnLength = cellLength;
        }
      });
      // A列(項目)は最低15、B列(内容)は最低35、最大幅は100に制限
      const minWidth = colIndex === 0 ? 15 : 35;
      column.width = Math.min(100, Math.max(minWidth, maxColumnLength + 5));
    });

    // Bufferへの書き出し
    const buffer = await workbook.xlsx.writeBuffer() as Buffer;

    // === 3. Google Driveへのアップロード ===
    const media = {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Readable.from(buffer),
    };

    const uploadRes = await drive.files.update({
      fileId: fileId,
      media: media,
      fields: "id, webViewLink",
    });

    fileLink = uploadRes.data.webViewLink;

    // アクセス権の付与 (リンクを知っている全員が閲覧可能)
    if (uploadRes.data.id) {
      await drive.permissions.create({
        fileId: uploadRes.data.id,
        requestBody: { role: "reader", type: "anyone" },
      });
    }

    // === 4. Google Calendarへのイベント作成 ===
    const mapLinks = location ? `
📍 マップ:
- Google Maps: https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}
- OpenStreetMap: https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=18/${location.lat}/${location.lng}
` : "";

    const description = `
【現場記録】
工事名: ${constructionName || "未入力"}
請負会社名: ${contractorName || "未入力"}
【工事内容】
${details || "未入力"}
${mapLinks}
📝 エクセル記録ファイル:
${fileLink || "リンク取得失敗"}
    `.trim();

    const endTime = new Date(now.getTime() + 60 * 60 * 1000); // 1時間後

    const event = {
      summary: `[現場記録] ${safeConstructionName}`,
      location: address || (location ? `${location.lat},${location.lng}` : undefined),
      description: description,
      start: { dateTime: now.toISOString(), timeZone: "Asia/Tokyo" },
      end: { dateTime: endTime.toISOString(), timeZone: "Asia/Tokyo" },
    };

    const calendarRes = await calendar.events.insert({
      calendarId: "primary",
      requestBody: event,
    });

    return NextResponse.json({ 
      success: true, 
      fileLink: fileLink,
      eventLink: calendarRes.data.htmlLink
    });

  } catch (error: any) {
    console.error("Sync Error:", error);
    return NextResponse.json({ error: error.message || "Failed to sync" }, { status: 500 });
  }
}
