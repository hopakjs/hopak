import type { ModelDefinition } from './define';

export class ModelRegistry {
  private readonly models = new Map<string, ModelDefinition>();

  register(model: ModelDefinition): void {
    if (this.models.has(model.name)) {
      throw new Error(`Model "${model.name}" is already registered`);
    }
    this.models.set(model.name, model);
  }

  get(name: string): ModelDefinition | undefined {
    return this.models.get(name);
  }

  has(name: string): boolean {
    return this.models.has(name);
  }

  all(): readonly ModelDefinition[] {
    return Array.from(this.models.values());
  }

  clear(): void {
    this.models.clear();
  }

  get size(): number {
    return this.models.size;
  }
}
