import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DictionariesTab from '@/components/admin/DictionariesTab.vue'

const apiMocks = vi.hoisted(() => ({
  tasksListDictionaries: vi.fn(),
  tasksCreateDictionary: vi.fn(),
  tasksUpdateDictionary: vi.fn(),
  tasksListDictionaryVersions: vi.fn(),
  tasksCreateDictionaryVersion: vi.fn(),
  tasksGetDictionaryVersionItems: vi.fn(),
}))

vi.mock('@/services/http/tasksApi', () => ({
  tasksListDictionaries: apiMocks.tasksListDictionaries,
  tasksCreateDictionary: apiMocks.tasksCreateDictionary,
  tasksUpdateDictionary: apiMocks.tasksUpdateDictionary,
  tasksListDictionaryVersions: apiMocks.tasksListDictionaryVersions,
  tasksCreateDictionaryVersion: apiMocks.tasksCreateDictionaryVersion,
  tasksGetDictionaryVersionItems: apiMocks.tasksGetDictionaryVersionItems,
}))

describe('DictionariesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.tasksListDictionaries.mockResolvedValue([
      {
        id: 'dict-1',
        code: 'priority',
        name: 'Priority',
        is_public: false,
        current_version: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])
    apiMocks.tasksListDictionaryVersions.mockResolvedValue([
      {
        id: 'ver-2',
        dictionary_id: 'dict-1',
        version: 2,
        created_at: '2026-01-02T00:00:00Z',
        created_by: 'user-1',
      },
      {
        id: 'ver-1',
        dictionary_id: 'dict-1',
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'user-1',
      },
    ])
    apiMocks.tasksGetDictionaryVersionItems.mockResolvedValue([
      {
        id: 'item-1',
        dictionary_version_id: 'ver-2',
        value_code: 'high',
        value_name: 'High',
        sort_order: 1,
        is_active: true,
      },
    ])
    apiMocks.tasksCreateDictionaryVersion.mockResolvedValue({
      id: 'ver-2',
      dictionary_id: 'dict-1',
      version: 2,
      created_at: '2026-01-02T00:00:00Z',
      created_by: 'user-1',
    })
    apiMocks.tasksUpdateDictionary.mockResolvedValue({
      id: 'dict-1',
      code: 'priority',
      name: 'Priority',
      is_public: true,
      current_version: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })
  })

  it('uses neutral item-editing copy', async () => {
    const wrapper = mount(DictionariesTab, {
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Edit Items')
    expect(wrapper.text()).not.toContain('New Version')
    expect(wrapper.text()).not.toContain('Save Version')
  })

  it('submits current items and refreshes dictionaries and versions after save', async () => {
    const wrapper = mount(DictionariesTab, {
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })
    await flushPromises()

    const versionsButton = wrapper.findAll('button').find(button => button.text() === 'Versions')
    expect(versionsButton).toBeTruthy()
    await versionsButton!.trigger('click')
    await flushPromises()

    const editButton = wrapper.findAll('button').find(button => button.text() === 'Edit Items')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Save Changes')

    const codeInputs = wrapper.findAll('input[placeholder="code"]')
    const nameInputs = wrapper.findAll('input[placeholder="Name"]')
    expect(codeInputs).toHaveLength(1)
    expect(nameInputs).toHaveLength(1)

    await codeInputs[0].setValue('high')
    await nameInputs[0].setValue('High')

    const addItemButton = wrapper.findAll('button').find(button => button.text() === '+ Add Item')
    expect(addItemButton).toBeTruthy()
    await addItemButton!.trigger('click')
    await flushPromises()

    const updatedCodeInputs = wrapper.findAll('input[placeholder="code"]')
    const updatedNameInputs = wrapper.findAll('input[placeholder="Name"]')
    const orderInputs = wrapper.findAll('input[type="number"]')
    await updatedCodeInputs[1].setValue('medium')
    await updatedNameInputs[1].setValue('Medium')
    await orderInputs[1].setValue('2')

    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save Changes')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.tasksCreateDictionaryVersion).toHaveBeenCalledWith('dict-1', [
      { value_code: 'high', value_name: 'High', sort_order: 1, is_active: true },
      { value_code: 'medium', value_name: 'Medium', sort_order: 2, is_active: true },
    ])
    expect(apiMocks.tasksListDictionaries).toHaveBeenCalledTimes(2)
    expect(apiMocks.tasksListDictionaryVersions).toHaveBeenCalledTimes(3)
  })

  it('submits is_public on create and allows toggling visibility', async () => {
    apiMocks.tasksCreateDictionary.mockResolvedValue({
      id: 'dict-2',
      code: 'versions',
      name: 'Versions',
      is_public: true,
      current_version: 1,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })

    const wrapper = mount(DictionariesTab, {
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Private')

    const createButton = wrapper.findAll('button').find(button => button.text() === 'Create Dictionary')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    await flushPromises()

    const codeInput = wrapper.find('input[placeholder="priority"]')
    const nameInput = wrapper.find('input[placeholder="Priority"]')
    const publicCheckbox = wrapper.find('input[type="checkbox"]')
    await codeInput.setValue('versions')
    await nameInput.setValue('Versions')
    await publicCheckbox.setValue(true)

    const confirmCreateButton = wrapper.findAll('button').find(button => button.text() === 'Create')
    expect(confirmCreateButton).toBeTruthy()
    await confirmCreateButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.tasksCreateDictionary).toHaveBeenCalledWith({
      code: 'versions',
      name: 'Versions',
      is_public: true,
    })

    const toggleButton = wrapper.findAll('button').find(button => button.text() === 'Private')
    expect(toggleButton).toBeTruthy()
    await toggleButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.tasksUpdateDictionary).toHaveBeenCalledWith('dict-1', { is_public: true })
    expect(wrapper.text()).toContain('Public')
  })
})
