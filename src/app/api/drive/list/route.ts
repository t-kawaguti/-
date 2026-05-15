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

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ 
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string
    });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // 初期状態（folderIdが指定されていない場合）は /電気仕事/工事記録 を取得
    if (!folderId || folderId === "root") {
      const folderId1 = await getOrCreateFolder(drive, "電気仕事");
      folderId = await getOrCreateFolder(drive, "工事記録", folderId1);
    }

    const query = `'${folderId}' in parents and trashed=false and name != 'presets.json'`;
    const res = await drive.files.list({
      q: query,
      fields: "files(id, name, mimeType, webViewLink, iconLink, modifiedTime)",
      orderBy: "folder, name desc"
    });

    return NextResponse.json({ 
      files: res.data.files, 
      currentFolderId: folderId 
    });

  } catch (error: any) {
    console.error("Drive list API Error:", error);
    return NextResponse.json({ error: "Failed to fetch drive contents" }, { status: 500 });
  }
}
