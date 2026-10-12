import { ValidationError } from '../../domain/finance'

export function fieldsFrom(error: unknown): Record<string, string> {
  return error instanceof ValidationError ? error.fields : { form: error instanceof Error ? error.message : 'Enregistrement impossible. Les données du formulaire sont conservées ; vérifiez le stockage et réessayez.' }
}
export function fieldA11y(name: string, errors: Record<string, string>) {
  return { id: name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `${name}-error` : undefined }
}
