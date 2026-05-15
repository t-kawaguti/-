import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Googleにログインしていません" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
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

    // Fetch the file metadata to get the mimeType
    const fileMeta = await drive.files.get({
      fileId: fileId,
      fields: "mimeType, name"
    });

    const mimeType = fileMeta.data.mimeType || "image/jpeg";

    // Fetch the actual file content
    const res = await drive.files.get(
      { fileId: fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(res.data as ArrayBuffer);
    const base64Str = buffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64Str}`;

    return NextResponse.json({ 
      success: true, 
      dataUri,
      name: fileMeta.data.name
    });

  } catch (error: any) {
    console.error("Drive Image Fetch Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch image" }, { status: 500 });
  }
}
