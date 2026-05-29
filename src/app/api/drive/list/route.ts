import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";

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

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let folderId = searchParams.get("folderId");
    const levelStr = searchParams.get("level");
    const level = levelStr ? parseInt(levelStr, 10) : 0;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ 
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string
    });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // 工事記録フォルダのIDを特定する
    const folderId1 = await getOrCreateFolder(drive, "電気仕事");
    const koziKirokuFolderId = await getOrCreateFolder(drive, "工事記録", folderId1);

    let folderName = "";

    // levelが0であるか、IDが指定されていない、またはrootかkoziKirokuFolderIdの場合は、強制的に最上位階層とする
    if (level === 0 || !folderId || folderId === "root" || folderId === koziKirokuFolderId) {
      folderId = koziKirokuFolderId;
      folderName = "工事記録";
    } else {
      const folderMeta = await drive.files.get({
        fileId: folderId,
        fields: "name"
      });
      folderName = folderMeta.data.name || "";
    }

    let files: any[] = [];

    if (level === 0) {
      // 1. 工事記録直下 (level=0)：[工事名] フォルダのみを表示する（黒板フォルダや他のファイルを除外）
      const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and name != '黒板' and trashed=false`;
      const res = await drive.files.list({
        q: query,
        fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
        orderBy: "name desc"
      });
      files = res.data.files || [];
    } else if (level === 1) {
      // 2. [工事名] フォルダの直下 (level=1)：今年度の月フォルダと、前年度以前の年フォルダを同階層に表示する
      const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const res = await drive.files.list({
        q: query,
        fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
        orderBy: "name desc"
      });
      const allDirs = res.data.files || [];
      
      const currentYear = new Date().getFullYear().toString();
      const thisYearFolder = allDirs.find((f: any) => f.name === currentYear);

      if (thisYearFolder) {
        // 今年のフォルダが存在する場合、その中身（月フォルダ群）を取得
        const monthsRes = await drive.files.list({
          q: `'${thisYearFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
          orderBy: "name desc"
        });
        const monthFiles = (monthsRes.data.files || []).filter((f: any) => /^\d{2}$/.test(f.name));
        
        // 今年のフォルダ自身を除外した年フォルダ（例: 2025）を取得
        const otherYears = allDirs.filter((f: any) => f.name !== currentYear && /^\d{4}$/.test(f.name));
        
        files = [...monthFiles, ...otherYears];
      } else {
        // 今年のフォルダがない場合は、年フォルダ（4桁の数字）のみに絞り込む
        files = allDirs.filter((f: any) => /^\d{4}$/.test(f.name));
      }
    } else if (level === 2) {
      // 3. level=2 (年フォルダ、または今年の月フォルダ)
      // 親フォルダの名前が4桁なら「年」、それ以外（2桁）なら「今年の月」と判別
      const folderMeta = await drive.files.get({
        fileId: folderId,
        fields: "name"
      });
      const fName = folderMeta.data.name || "";
      if (/^\d{4}$/.test(fName)) {
        // 年フォルダ直下 ➔ 月フォルダ（2桁）を表示
        const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const res = await drive.files.list({
          q: query,
          fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
          orderBy: "name desc"
        });
        files = (res.data.files || []).filter((f: any) => /^\d{2}$/.test(f.name));
      } else {
        // 今年の月フォルダ直下 ➔ Excelファイルのみを表示
        const query = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
        const res = await drive.files.list({
          q: query,
          fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
          orderBy: "name desc"
        });
        files = (res.data.files || []).filter((f: any) => f.name.endsWith(".xlsx"));
      }
    } else {
      // 4. level=3 (過去の月フォルダ直下)：Excelファイル（.xlsx）のみを表示
      const query = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
      const res = await drive.files.list({
        q: query,
        fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
        orderBy: "name desc"
      });
      files = (res.data.files || []).filter((f: any) => f.name.endsWith(".xlsx"));
    }

    return NextResponse.json({ 
      files: files, 
      currentFolderId: folderId 
    });

  } catch (error: any) {
    console.error("Drive list API Error:", error);
    return NextResponse.json({ error: "Failed to fetch drive contents" }, { status: 500 });
  }
}
