import { redirect } from 'next/navigation';

export default function SettingsIndex() {
  redirect('/portal/settings/profile');
}
