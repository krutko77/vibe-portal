// Домашняя папка ученика ВНУТРИ контейнера зависит от роли:
// admin (сам преподаватель) работает в /home/my_workspace, ученики — в
// /home/student/workspace (изолированный workspace, отдельно от служебных
// /home/student/{templates,.claude,.sshd,...}). Единственный источник истины
// для всех мест, где путь захардкожен (dockerCreate, code-slots, ssh-access,
// publish, entrypoint через $HOME).
export function homeDirFor(role) {
  return role === 'admin' ? '/home/my_workspace' : '/home/student/workspace';
}
