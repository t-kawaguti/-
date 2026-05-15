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
      return NextResponse.json({ error: "Googleにログインしていません" }, { status: 401 });
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

    // 1. Ensure the hierarchy exists: 電気仕事 > 工事記録 > 黒板
    const folderId1 = await getOrCreateFolder(drive, "電気仕事");
    const folderId2 = await getOrCreateFolder(drive, "工事記録", folderId1);
    const blackboardFolderId = await getOrCreateFolder(drive, "黒板", folderId2);

    // 2. Fetch images (jpeg/png) from the blackboard folder
    const query = `'${blackboardFolderId}' in parents and trashed=false and (mimeType='image/jpeg' or mimeType='image/png')`;
    
    const res = await drive.files.list({
      q: query,
      fields: "files(id, name, mimeType, thumbnailLink)",
      orderBy: "modifiedTime desc"
    });

    return NextResponse.json({ 
      success: true, 
      folderId: blackboardFolderId,
      images: res.data.files || [] 
    });

  } catch (error: any) {
    console.error("Blackboard Image List Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch blackboard images" }, { status: 500 });
  }
}
