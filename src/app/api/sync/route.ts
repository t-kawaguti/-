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
      saveFolderName
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

    // === 2. Excel (xlsx) の生成 ===
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("現場記録");

    // カラム幅の設定
    sheet.getColumn(1).width = 15;
    sheet.getColumn(2).width = 50;

    // ヘッダー行
    sheet.addRow(["項目", "内容"]);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };

    // データ行
    sheet.addRow(["工事名", constructionName || ""]);
    sheet.addRow(["請負会社名", contractorName || ""]);
    sheet.addRow(["工事内容", details || ""]);
    sheet.addRow(["工事記録", record || ""]);
    sheet.addRow(["場所", address || (location ? `${location.lat},${location.lng}` : "未取得")]);
    sheet.addRow(["日時", now.toLocaleString("ja-JP")]);

    // 罫線と折り返し設定
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' },
          bottom: { style: 'thin' }, right: { style: 'thin' }
        };
        cell.alignment = { wrapText: true, vertical: 'middle' };
      });
      // 内容に応じて高さを自動調整する代わりに、少し高めにする
      if (rowNumber > 1) row.height = 30; 
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
        // 1枚目: B8:E30
        // 2枚目: B32:E54
        // 3枚目: B56:E78
        const startRow = 8 + (index * 24);
        const endRow = startRow + 22;
        const range = `B${startRow}:E${endRow}`;
        
        sheet.addImage(imageId, range);
      });
    }

    // Bufferへの書き出し
    const buffer = await workbook.xlsx.writeBuffer() as Buffer;

    // === 3. Google Driveへのアップロード ===
    const safeConstructionName = constructionName ? constructionName.replace(/\//g, "_") : "名称未設定";
    const fileName = `${safeConstructionName}_${now.getTime()}.xlsx`;
    const media = {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Readable.from(buffer),
    };

    const uploadRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderIdMonth],
      },
      media: media,
      fields: "id, webViewLink",
    });

    const fileLink = uploadRes.data.webViewLink;

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
