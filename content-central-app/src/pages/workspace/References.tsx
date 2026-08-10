import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceContext } from "@/layouts/ProjectWorkspaceLayout";
import {
  REFERENCE_AUTOMATIC_RULES,
  REFERENCE_CATEGORY_LABELS,
  REFERENCE_ROLE_LABELS,
  deleteReference,
  fileToDataUrl,
  researchOnline,
  roleForReferenceCategory,
  saveAsset,
  saveImageRules,
  updateReference,
  type ProjectReference,
} from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import styles from "./References.module.css";

const USAGE_ROLE_OPTIONS = [
  { value: "layout_model", label: "Formato/layout" },
  { value: "product_photo", label: "Produto/foto" },
  { value: "text_parameter", label: "Copy/texto" },
  { value: "visual_reference", label: "Estilo visual" },
  { value: "brand_asset", label: "Logo/marca" },
];

export function References() {
  const { project, refreshProject } = useOutletContext<WorkspaceContext>();
  const references = project.brand?.references || [];

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [visualStyle, setVisualStyle] = useState(project.brand?.visualStyle || "");
  const [imageRules, setImageRules] = useState((project.brand?.imageRules || []).join("\n"));
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);

  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchMessage, setResearchMessage] = useState<string | null>(null);

  const refInputRef = useRef<HTMLInputElement>(null);
  const [refCategory, setRefCategory] = useState("visual_inspiration");
  const [refInstruction, setRefInstruction] = useState("");
  const [refUseInNext, setRefUseInNext] = useState(true);
  const [refUsageRoles, setRefUsageRoles] = useState<string[]>(["visual_reference"]);
  const [refWeight, setRefWeight] = useState("medium");
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("visual_inspiration");
  const [editInstruction, setEditInstruction] = useState("");
  const [editUseInNext, setEditUseInNext] = useState(true);
  const [editUsageRoles, setEditUsageRoles] = useState<string[]>(["visual_reference"]);
  const [editWeight, setEditWeight] = useState("medium");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function toggleEditUsageRole(value: string) {
    setEditUsageRoles((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  }

  const colors = [...(project.brandIdentity?.editedColors || []), ...(project.brandIdentity?.extractedColors || [])];

  function toggleUsageRole(value: string) {
    setRefUsageRoles((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  }

  async function handleUploadLogo() {
    const file = logoInputRef.current?.files?.[0];
    if (!file) {
      setLogoError("Escolha um arquivo de logo.");
      return;
    }
    setLogoBusy(true);
    setLogoError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await saveAsset(project.projectId, {
        kind: "logo",
        filename: file.name,
        dataUrl,
        role: "brand_asset",
        usageRoles: ["brand_asset"],
        referenceCategory: "official_asset",
        useInNextGeneration: true,
        instruction: "Logo oficial da marca. Preservar exatamente como enviado.",
      });
      if (logoInputRef.current) logoInputRef.current.value = "";
      await refreshProject();
    } catch (err) {
      setLogoError((err as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleSaveRules() {
    setRulesBusy(true);
    setRulesError(null);
    setRulesMessage(null);
    try {
      await saveImageRules(project.projectId, visualStyle, imageRules);
      await refreshProject();
      setRulesMessage("Direção visual salva.");
    } catch (err) {
      setRulesError((err as Error).message);
    } finally {
      setRulesBusy(false);
    }
  }

  async function handleResearchOnline() {
    setResearchBusy(true);
    setResearchError(null);
    setResearchMessage(null);
    try {
      const result = await researchOnline(project.projectId);
      // Mirror the server's own merge (new findings replace only the
      // previous "[Pesquisa online]" lines, hand-written rules stay) so the
      // textarea reflects reality immediately, without waiting on a project
      // refresh that this component doesn't resync local state from.
      setImageRules((current) => {
        const kept = current
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("[Pesquisa online]"));
        return [...result.findings, ...kept].join("\n");
      });
      await refreshProject();
      setResearchMessage(`Pesquisa concluída — ${result.findings.length} direção(ões) visual(is) adicionada(s) abaixo.`);
    } catch (err) {
      setResearchError((err as Error).message);
    } finally {
      setResearchBusy(false);
    }
  }

  async function handleUploadReferences() {
    const files = Array.from(refInputRef.current?.files || []);
    if (!files.length) {
      setRefError("Escolha pelo menos uma referência.");
      return;
    }
    setRefBusy(true);
    setRefError(null);
    try {
      const role = roleForReferenceCategory(refCategory, refUsageRoles);
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        await saveAsset(project.projectId, {
          kind: "reference",
          filename: file.name,
          dataUrl,
          role,
          usageRoles: refUsageRoles,
          referenceCategory: refCategory,
          useInNextGeneration: refUseInNext,
          weight: refWeight,
          instruction: refInstruction,
        });
      }
      if (refInputRef.current) refInputRef.current.value = "";
      setRefInstruction("");
      await refreshProject();
    } catch (err) {
      setRefError((err as Error).message);
    } finally {
      setRefBusy(false);
    }
  }

  async function handleDeleteReference(reference: ProjectReference) {
    if (!confirm("Apagar esta referência do projeto?")) return;
    setDeletingPath(reference.relativePath);
    setRefError(null);
    try {
      await deleteReference(project.projectId, reference.relativePath);
      if (editingPath === reference.relativePath) setEditingPath(null);
      await refreshProject();
    } catch (err) {
      setRefError((err as Error).message);
    } finally {
      setDeletingPath(null);
    }
  }

  function handleEditReference(reference: ProjectReference) {
    setEditingPath(reference.relativePath);
    setEditCategory(reference.referenceCategory);
    setEditInstruction(reference.instruction || "");
    setEditUseInNext(reference.useInNextGeneration !== false);
    setEditUsageRoles(reference.usageRoles?.length ? reference.usageRoles : [reference.role]);
    setEditWeight(reference.weight);
    setEditError(null);
  }

  function handleCancelEditReference() {
    setEditingPath(null);
    setEditError(null);
  }

  async function handleSaveReferenceEdit() {
    if (!editingPath) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await updateReference(project.projectId, editingPath, {
        referenceCategory: editCategory,
        role: roleForReferenceCategory(editCategory, editUsageRoles),
        usageRoles: editUsageRoles,
        instruction: editInstruction,
        useInNextGeneration: editUseInNext,
        weight: editWeight,
      });
      setEditingPath(null);
      await refreshProject();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 var(--space-2xs)" }}>Painel de referências</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Referência não deve disputar com o Raio-X. Separe ativos oficiais, fotos reais/produtos e inspirações visuais.
      </p>

      <div className={styles.categoryGrid}>
        <div className="notice">
          <b>Ativos oficiais da marca</b>
          <br />
          <span className="muted">Logo, mascote, cardápio, embalagem e identidade oficial. Preservar exatamente como enviado.</span>
        </div>
        <div className="notice">
          <b>Fotos reais e produtos</b>
          <br />
          <span className="muted">Pizza, prato, ambiente, equipe ou embalagem real. Preservar aparência real, sem trocar produto.</span>
        </div>
        <div className="notice">
          <b>Inspirações visuais</b>
          <br />
          <span className="muted">Flyer, layout, fotografia, composição ou paleta. Usar só como inspiração.</span>
        </div>
      </div>

      <div className="grid">
        <Card className="field-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Ativo oficial principal</h3>
          <label htmlFor="logo-file">Arquivo de logo</label>
          <input ref={logoInputRef} id="logo-file" type="file" accept="image/*" />
          <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={logoBusy} onClick={handleUploadLogo}>
            {logoBusy ? "Enviando..." : "Enviar logo"}
          </Button>
          {logoError ? <div className="pill bad" style={{ marginTop: 10 }}>{logoError}</div> : null}
          <div className="notice" style={{ marginTop: 12 }}>
            <b>Cores identificadas na logo</b>
            <br />
            <span className="muted">
              {colors.length ? colors.join(", ") : "Envie a logo para identificar as cores automaticamente."}
            </span>
            {project.brand?.logoPath ? <div style={{ marginTop: 6 }}><span className="pill ok">logo enviada</span></div> : null}
          </div>
        </Card>

        <Card className="field-card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Direção visual consolidada</h3>
          <label htmlFor="visual-style">Resumo visual gerado/aprovado</label>
          <textarea id="visual-style" value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} />
          <label htmlFor="image-rules">Regras técnicas extras para o ChatGPT</label>
          <textarea
            id="image-rules"
            placeholder="Use só quando necessário. Ex: texto curto, área segura, não inventar preço."
            value={imageRules}
            onChange={(e) => setImageRules(e.target.value)}
          />
          <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={rulesBusy} onClick={handleSaveRules}>
            {rulesBusy ? "Salvando..." : "Salvar direção visual consolidada"}
          </Button>
          {rulesError ? <div className="pill bad" style={{ marginTop: 10 }}>{rulesError}</div> : null}
          {rulesMessage ? <div className="pill ok" style={{ marginTop: 10 }}>{rulesMessage}</div> : null}

          <div className="notice" style={{ marginTop: 14 }}>
            <b>Pesquisar referências online</b>
            <br />
            <span className="muted">
              Busca na internet tendências visuais atuais para o segmento cadastrado (Empresa/Raio-X) e adiciona como direção
              visual acima — só padrão (cor, composição, tipografia), nunca copiando marca/texto de concorrente. Cada pesquisa
              nova substitui a anterior; regras que você escreveu à mão não são afetadas.
            </span>
          </div>
          <Button variant="secondary" className="full-width" style={{ marginTop: 8 }} disabled={researchBusy} onClick={handleResearchOnline}>
            {researchBusy ? "Pesquisando..." : "Pesquisar referências online"}
          </Button>
          {researchError ? <div className="pill bad" style={{ marginTop: 10 }}>{researchError}</div> : null}
          {researchMessage ? <div className="pill ok" style={{ marginTop: 10 }}>{researchMessage}</div> : null}
        </Card>
      </div>

      <Card style={{ padding: 20, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Criativos, modelos, fotos ou parâmetros</h3>
          <span className="pill">categoria + regra automática</span>
        </div>
        <label htmlFor="reference-file">Arquivos</label>
        <input ref={refInputRef} id="reference-file" type="file" accept="image/*,.pdf,.txt,.md,.doc,.docx" multiple />

        <div className={styles.toolbar}>
          <div>
            <label htmlFor="reference-category">Categoria da referência</label>
            <select id="reference-category" value={refCategory} onChange={(e) => setRefCategory(e.target.value)}>
              {Object.entries(REFERENCE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reference-instruction">Observação curta</label>
            <input
              id="reference-instruction"
              placeholder="Ex: usar só hierarquia / preservar produto / seguir clima visual"
              value={refInstruction}
              onChange={(e) => setRefInstruction(e.target.value)}
            />
          </div>
          <div>
            <label className="pill" style={{ marginTop: 28, width: "max-content" }}>
              <input type="checkbox" checked={refUseInNext} onChange={(e) => setRefUseInNext(e.target.checked)} /> Usar na
              próxima geração
            </label>
          </div>
        </div>

        <div className="guide-box" style={{ marginTop: 10 }}>
          Regra automática: {REFERENCE_AUTOMATIC_RULES[refCategory]}
        </div>

        <div className="field-card" style={{ marginTop: 10 }}>
          <label>Função técnica</label>
          <div className={styles.roleRow}>
            {USAGE_ROLE_OPTIONS.map((option) => (
              <label key={option.value} className="pill">
                <input
                  type="checkbox"
                  checked={refUsageRoles.includes(option.value)}
                  onChange={() => toggleUsageRole(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <label htmlFor="reference-weight">Prioridade</label>
          <select id="reference-weight" value={refWeight} onChange={(e) => setRefWeight(e.target.value)}>
            <option value="medium">Médio</option>
            <option value="high">Alto</option>
            <option value="low">Baixo</option>
          </select>
        </div>

        <Button variant="secondary" className="full-width" style={{ marginTop: 10 }} disabled={refBusy} onClick={handleUploadReferences}>
          {refBusy ? "Enviando..." : "Enviar referências"}
        </Button>
        {refError ? <div className="pill bad" style={{ marginTop: 10 }}>{refError}</div> : null}

        <div className={styles.gallery}>
          {references.length === 0 ? (
            <p className="muted">Nenhuma referência enviada ainda.</p>
          ) : (
            references.map((reference) => {
              const isImage = reference.mimeType?.startsWith("image/");
              return (
                <div key={reference.id} className={styles.card}>
                  <div className={styles.thumb}>
                    {isImage ? <img src={reference.previewUrl} alt={reference.filename} /> : <span>{reference.filename}</span>}
                  </div>
                  <div className={styles.body}>
                    <div className={styles.name}>{reference.filename}</div>
                    <div className={styles.meta}>
                      <span className="pill">{REFERENCE_CATEGORY_LABELS[reference.referenceCategory] || reference.referenceCategory}</span>
                      <span className="pill">
                        {(reference.usageRoles?.length ? reference.usageRoles : [reference.role])
                          .map((role) => REFERENCE_ROLE_LABELS[role] || role)
                          .join(", ")}
                      </span>
                      <span className="pill">{reference.useInNextGeneration === false ? "não usar" : "usar próxima"}</span>
                      <span className="pill">prioridade {reference.weight}</span>
                    </div>
                    <div className={styles.note}>
                      <b>Regra automática:</b> {reference.automaticRule || REFERENCE_AUTOMATIC_RULES[reference.referenceCategory]}
                      <br />
                      <b>Obs:</b> {reference.instruction || "Sem observação específica."}
                    </div>

                    {editingPath === reference.relativePath ? (
                      <div className="field-card" style={{ marginTop: 10 }}>
                        <label htmlFor={`edit-category-${reference.id}`}>Categoria da referência</label>
                        <select
                          id={`edit-category-${reference.id}`}
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                        >
                          {Object.entries(REFERENCE_CATEGORY_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <label htmlFor={`edit-instruction-${reference.id}`}>Observação curta</label>
                        <input
                          id={`edit-instruction-${reference.id}`}
                          value={editInstruction}
                          onChange={(e) => setEditInstruction(e.target.value)}
                        />
                        <label>Função técnica</label>
                        <div className={styles.roleRow}>
                          {USAGE_ROLE_OPTIONS.map((option) => (
                            <label key={option.value} className="pill">
                              <input
                                type="checkbox"
                                checked={editUsageRoles.includes(option.value)}
                                onChange={() => toggleEditUsageRole(option.value)}
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                        <label className="pill" style={{ margin: "8px 0", width: "max-content" }}>
                          <input type="checkbox" checked={editUseInNext} onChange={(e) => setEditUseInNext(e.target.checked)} />{" "}
                          Usar na próxima geração
                        </label>
                        <label htmlFor={`edit-weight-${reference.id}`}>Prioridade</label>
                        <select id={`edit-weight-${reference.id}`} value={editWeight} onChange={(e) => setEditWeight(e.target.value)}>
                          <option value="low">Baixo</option>
                          <option value="medium">Médio</option>
                          <option value="high">Alto</option>
                        </select>
                        {editError ? <div className="pill bad" style={{ marginTop: 10 }}>{editError}</div> : null}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <Button disabled={editBusy} onClick={handleSaveReferenceEdit}>
                            {editBusy ? "Salvando..." : "Salvar"}
                          </Button>
                          <Button variant="secondary" onClick={handleCancelEditReference}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                        <Button variant="secondary" onClick={() => handleEditReference(reference)}>
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={deletingPath === reference.relativePath}
                          onClick={() => handleDeleteReference(reference)}
                        >
                          {deletingPath === reference.relativePath ? "Apagando..." : "Apagar referência"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
