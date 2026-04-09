import re

with open("src/index.html", "r") as f:
    content = f.read()

# I need to add the Stats grid and conditional logic in the RecipeCard component

new_recipe_card = r"""function RecipeCard({ recipe }) {
    const [exporting, setExporting] = useState(false);
    const [exported, setExported] = useState(null);
    const [exportError, setExportError] = useState(null);

    const handleExport = async () => {
      setExporting(true);
      setExportError(null);
      try {
        const json = await runScript('createRecipeDoc', recipe);
        setExported(JSON.parse(json));
      } catch (err) {
        setExportError(err.message || 'Export failed.');
      } finally {
        setExporting(false);
      }
    };

    return (
      <div className="fade-in rounded-xl border border-zinc-700/50 overflow-hidden bg-zinc-900 w-full max-w-lg mb-4 shadow-2xl">
        {/* HERO IMAGE SECTION */}
        {recipe.imageUrl && (
          <div className="w-full h-48 bg-zinc-800 border-b border-zinc-700/50 relative">
            <img
              src={recipe.imageUrl}
              alt={recipe.title}
              className="w-full h-full object-cover opacity-90"
              onError={(e) => e.target.style.display = 'none'}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent pointer-events-none" />
          </div>
        )}

        <div className="bg-gradient-to-br from-emerald-900 to-emerald-800 px-5 py-4">
          <h3 className="text-lg font-bold text-white leading-tight">{recipe.title}</h3>
          <p className="text-xs text-emerald-200/70 mt-1 line-clamp-2">{recipe.description}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 divide-x divide-zinc-700/50 border-b border-zinc-700/50 bg-zinc-900/50">
          {[
            { label: 'Prep', value: recipe.prepTime },
            { label: 'Cook', value: recipe.cookTime },
            { label: 'Serves', value: recipe.servings }
          ].map(({ label, value }) => (
            <div key={label} className="py-3 text-center">
              <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</p>
              <p className="text-sm font-semibold text-zinc-200 mt-0.5">{value || 'N/A'}</p>
            </div>
          ))}
        </div>

        <div className="p-5 space-y-6">
          {/* Ingredients */}
          {recipe.ingredients?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2.5">Ingredients</h4>
            <ul className="text-sm text-zinc-300 space-y-1.5">
              {recipe.ingredients.map((ing, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-500/50">•</span>
                  <span>{ing}</span>
                </li>
              ))}
            </ul>
          </div>
          )}

          {/* Instructions */}
          {recipe.instructions?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2.5">Instructions</h4>
            <ol className="text-sm text-zinc-300 space-y-3">
              {recipe.instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded bg-zinc-800 text-[10px] font-bold text-emerald-400 flex items-center justify-center border border-zinc-700">{i+1}</span>
                  <span className="leading-relaxed">{step.replace(/^(Step\s*\d+[:.]\s*|\d+[:.]\s*)/i, '')}</span>
                </li>
              ))}
            </ol>
          </div>
          )}

          <div className="pt-4 border-t border-zinc-800/50">
            {exported ? (
              <div className="flex items-center justify-between bg-emerald-900/20 p-3 rounded-lg border border-emerald-900/30">
                <span className="text-xs text-emerald-400 font-bold">✓ READY IN GOOGLE DRIVE</span>
                <a href={exported.url} target="_blank" className="flex items-center gap-1.5 text-xs text-white font-bold underline decoration-emerald-500/50">
                  OPEN DOC <ExternalLinkIcon />
                </a>
              </div>
            ) : (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-all disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-bold uppercase tracking-widest"
              >
                {exporting ? <><SpinnerIcon size={14} /> GENERATING...</> : <><DocIcon /> EXPORT TO GOOGLE DOC</>}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }"""

pattern = re.compile(r'function RecipeCard\(\{ recipe \}\) \{.*?// ─── MessageBubble Component ─+', re.DOTALL)
content = pattern.sub(lambda match: new_recipe_card + "\n\n    // ─── MessageBubble Component ──────────────────────────────────────────────", content)

with open("src/index.html", "w") as f:
    f.write(content)

print("Updated index.html")
