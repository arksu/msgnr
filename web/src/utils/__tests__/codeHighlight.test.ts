import { describe, expect, it } from 'vitest'
import { highlightCodeToHtml } from '@/utils/codeHighlight'

describe('highlightCodeToHtml', () => {
  it.each([
    ['sql', 'SELECT id FROM users WHERE active = true;', 'language-sql'],
    ['kotlin', 'fun greet(name: String) = println(name)', 'language-kotlin'],
    ['java', 'public class App { public static void main(String[] args) {} }', 'language-java'],
    ['go', 'package main\nfunc main() { fmt.Println("hi") }', 'language-go'],
    ['shell', 'if [ -f package.json ]; then echo "ok"; fi', 'language-shell'],
    ['typescript', 'const value: string = "hello"', 'language-typescript'],
    ['javascript', 'const value = "hello"', 'language-javascript'],
    ['python', 'def greet(name):\n    return f"hi {name}"', 'language-python'],
  ])('highlights explicit %s fences', (language, code, className) => {
    const html = highlightCodeToHtml(code, language)

    expect(html).toContain(className)
    expect(html).toContain('class="hljs')
    expect(html).toContain('<span class="hljs-')
  })

  it.each([
    ['ts', 'const value: string = "hello"', 'language-typescript'],
    ['js', 'const value = "hello"', 'language-javascript'],
    ['sh', 'if [ -f package.json ]; then echo "ok"; fi', 'language-shell'],
    ['zsh', 'if [ -f package.json ]; then echo "ok"; fi', 'language-shell'],
    ['postgresql', 'SELECT id FROM users WHERE active = true;', 'language-sql'],
    ['postgres', 'SELECT id FROM users WHERE active = true;', 'language-sql'],
    ['psql', 'SELECT id FROM users WHERE active = true;', 'language-sql'],
  ])('normalizes the %s alias', (language, code, className) => {
    const html = highlightCodeToHtml(code, language)

    expect(html).toContain(className)
  })

  it('emits the language label only on the pre wrapper', () => {
    const html = highlightCodeToHtml('package main', 'go')

    expect(html).toContain('<pre class="markdown-code-block language-go" data-language="Go">')
    expect(html).toContain('<code class="hljs language-go">')
    expect(html).not.toContain('<code class="hljs language-go" data-language=')
  })

  it.each([
    ['SELECT id, name FROM users WHERE active = true;', 'language-sql'],
    ['package main\nfunc main() { fmt.Println("hi") }', 'language-go'],
    ['def hello(name):\n    return f"hi {name}"', 'language-python'],
  ])('autodetects unlabeled code blocks', (code, className) => {
    const html = highlightCodeToHtml(code)

    expect(html).toContain(className)
    expect(html).toContain('<span class="hljs-')
  })

  it('falls back to escaped plain code for low-confidence autodetection', () => {
    const html = highlightCodeToHtml('plain words only <T>')

    expect(html).toContain('plain words only &lt;T&gt;')
    expect(html).not.toContain('data-language=')
    expect(html).not.toContain('<span class="hljs-')
  })

  it('falls back from unknown explicit languages to autodetection', () => {
    const html = highlightCodeToHtml('SELECT id FROM users WHERE active = true;', 'madeuplang')

    expect(html).toContain('language-sql')
    expect(html).toContain('<span class="hljs-keyword">SELECT</span>')
  })
})
