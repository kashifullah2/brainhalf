import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import { Library, Upload, Trash2, FileImage } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { clientApi } from "../lib/api-url";

export const meta: MetaFunction = () => {
  return [
    { title: "Assets | Dashboard" }
  ];
};

export async function loader({ context }: LoaderFunctionArgs) {
  // Simulated D1 fetch for assets
  return Response.json({ assets: [] });
}

export default function AssetsPage() {
  const { assets: initialAssets } = useLoaderData<typeof loader>() as any;
  const [assets, setAssets] = useState<any[]>(initialAssets);
  const navigate = useNavigate();

  const deleteAsset = async (id: string) => {
    await fetch(clientApi(`/api/assets/${id}`), { method: "DELETE", credentials: "include" });
    setAssets(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div style={{ padding: "40px 48px", height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)" }}>Asset Library</h1>
          <p style={{ fontSize: 14, color: "var(--text-2)" }}>Manage your uploaded images, textures, and models.</p>
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>
          <Upload size={16} /> Upload Asset
        </button>
      </div>

      {assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, border: "1px dashed var(--border)", borderRadius: 12 }}>
          <Library size={48} color="var(--text-3)" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontSize: 16, fontWeight: 500, color: "var(--text)", marginBottom: 8 }}>No assets yet</h3>
          <p style={{ fontSize: 14, color: "var(--text-2)" }}>Upload textures or sounds to use in your games.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20 }}>
          {assets.map(asset => (
            <div key={asset.id} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-2)" }}>
              <div style={{ height: 140, background: "var(--bg-3)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                {asset.assetType === 'texture' ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img src={asset.fileUrl} alt={asset.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <FileImage size={40} color="var(--text-3)" />
                )}
              </div>
              <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{asset.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace", marginTop: 2 }}>{Math.round(asset.fileSize / 1024)} KB</div>
                </div>
                <button onClick={() => deleteAsset(asset.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--red)", padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
