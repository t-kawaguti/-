import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
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

// Find presets.json
async function findPresetsFile(drive: any, folderId: string) {
  const query = `name='presets.json' and '${folderId}' in parents and trashed=false`;
  const res = await drive.files.list({ q: query, fields: "files(id)" });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken as string });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const folderId1 = await getOrCreateFolder(drive, "電気仕事");
    const folderId2 = await getOrCreateFolder(drive, "工事記録", folderId1);
    
    const fileId = await findPresetsFile(drive, folderId2);
    if (!fileId) {
      // Default empty presets 01 to 10
      const defaultPresets = Array.from({ length: 10 }, (_, i) => ({
        id: String(i + 1).padStart(2, '0'),
        constructionName: "",
        contractorName: "",
        details: ""
      }));
      return NextResponse.json(defaultPresets);
    }

    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    const presets = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    
    return NextResponse.json(presets);

  } catch (error: any) {
    console.error("Presets GET Error:", error);
    return NextResponse.json({ error: "Failed to get presets" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const presets = await req.json();

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken as string });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const folderId1 = await getOrCreateFolder(drive, "電気仕事");
    const folderId2 = await getOrCreateFolder(drive, "工事記録", folderId1);
    
    const fileId = await findPresetsFile(drive, folderId2);
    
    const fileMetadata = {
      name: 'presets.json',
      mimeType: 'application/json'
    };
    const media = {
      mimeType: 'application/json',
      body: JSON.stringify(presets)
    };

    if (fileId) {
      await drive.files.update({
        fileId: fileId,
        media: media
      });
    } else {
      await drive.files.create({
        requestBody: {
          ...fileMetadata,
          parents: [folderId2]
        },
        media: media
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Presets POST Error:", error);
    return NextResponse.json({ error: "Failed to save presets" }, { status: 500 });
  }
}
