export interface ExternalEmbeddingConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export function createExternalEmbedding(config: ExternalEmbeddingConfig): {
  run<T = unknown>(model: string, inputs: unknown): Promise<T>
} {
  return {
    async run<T>(model: string, inputs: unknown): Promise<T> {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model || model,
          input: (inputs as { text?: string[] })?.text ?? inputs,
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Embedding API returned ${response.status}: ${detail.slice(0, 300)}`)
      }
      return await response.json() as T
    },
  }
}
