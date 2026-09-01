import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card } from "@/components/Card";

interface TemplatePiece {
  key: string;
  label: string;
  channel: string;
  angleNote: string;
  storagePath?: string;
}

interface SegmentTemplateRow {
  id: string;
  segment_id: string;
  label: string;
  pieces: TemplatePiece[];
}

export function SegmentTemplates() {
  const [templates, setTemplates] = useState<SegmentTemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  async function load() {
    const { data, error: queryError } = await supabase
      .from("segment_templates")
      .select("id, segment_id, label, pieces")
      .order("label");
    if (queryError) { setError(queryError.message); return; }
    setTemplates((data || []).map((row) => ({ ...row, pieces: Array.isArray(row.pieces) ? row.pieces : [] })));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    templates?.forEach((template) => {
      const pieces = Array.isArray(template?.pieces) ? template.pieces : [];
      pieces.forEach(async (piece) => {
        const cacheKey = `${template.id}-${piece.key}`;
        if (!piece.storagePath || signedUrls[cacheKey]) return;
        const { data } = await supabase.storage.from("content-media").createSignedUrl(piece.storagePath, 300);
        if (data) setSignedUrls((prev) => ({ ...prev, [cacheKey]: data.signedUrl }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  if (error) return <div className="card">Erro: {error}</div>;
  if (!templates) return <div className="card">Carregando...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h2 style={{ margin: "0 0 var(--space-lg)" }}>Templates de Segmento</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>Somente leitura — criar/editar template continua via script local.</p>
      {templates.length === 0 ? <p>Nenhum template registrado ainda.</p> : null}
      {templates.map((template) => (
        <Card key={template.id} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0 }}>{template.label}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {(Array.isArray(template?.pieces) ? template.pieces : []).map((piece) => {
              const cacheKey = `${template.id}-${piece.key}`;
              return (
                <div key={piece.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {signedUrls[cacheKey] ? (
                    <img src={signedUrls[cacheKey]} alt={piece.label} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 4 }} />
                  ) : (
                    <span style={{ width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center", background: "#eee", borderRadius: 4, fontSize: 11 }}>
                      sem imagem
                    </span>
                  )}
                  <span style={{ fontSize: 12 }}>{piece.label}</span>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
