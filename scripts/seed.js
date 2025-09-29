const { supabaseAdmin } = require('../config/supabase');
require('dotenv').config();

// Sample data for seeding the database
const sampleData = {
  users: [
    {
      email: 'john.doe@example.com',
      password: 'password123',
      full_name: 'John Doe'
    },
    {
      email: 'jane.smith@example.com',
      password: 'password123',
      full_name: 'Jane Smith'
    },
    {
      email: 'mike.johnson@example.com',
      password: 'password123',
      full_name: 'Mike Johnson'
    }
  ],
  workspaces: [
    {
      name: 'Acme Corp',
      description: 'Main workspace for Acme Corporation'
    },
    {
      name: 'Project Alpha',
      description: 'Workspace for Project Alpha development'
    }
  ]
};

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');

    // Create users
    const createdUsers = [];
    for (const userData of sampleData.users) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: userData.email,
        password: userData.password,
        email_confirm: true
      });

      if (authError) {
        console.error(`Error creating user ${userData.email}:`, authError);
        continue;
      }

      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authData.user.id,
          email: userData.email,
          full_name: userData.full_name
        })
        .select()
        .single();

      if (profileError) {
        console.error(`Error creating profile for ${userData.email}:`, profileError);
        continue;
      }

      createdUsers.push(profile);
      console.log(`✅ Created user: ${userData.email}`);
    }

    if (createdUsers.length === 0) {
      console.log('❌ No users created. Exiting...');
      return;
    }

    // Create workspaces
    const createdWorkspaces = [];
    for (const workspaceData of sampleData.workspaces) {
      const { data: workspace, error: workspaceError } = await supabaseAdmin
        .from('workspaces')
        .insert({
          name: workspaceData.name,
          description: workspaceData.description,
          owner_id: createdUsers[0].id // First user becomes owner
        })
        .select()
        .single();

      if (workspaceError) {
        console.error(`Error creating workspace ${workspaceData.name}:`, workspaceError);
        continue;
      }

      // Add all users as members
      for (const user of createdUsers) {
        await supabaseAdmin
          .from('workspace_members')
          .insert({
            workspace_id: workspace.id,
            user_id: user.id,
            role: user.id === createdUsers[0].id ? 'owner' : 'member'
          });
      }

      createdWorkspaces.push(workspace);
      console.log(`✅ Created workspace: ${workspaceData.name}`);
    }

    if (createdWorkspaces.length === 0) {
      console.log('❌ No workspaces created. Exiting...');
      return;
    }

    // Create sample task board for first workspace
    const { data: taskBoard, error: boardError } = await supabaseAdmin
      .from('task_boards')
      .insert({
        workspace_id: createdWorkspaces[0].id,
        name: 'Project Tasks',
        description: 'Main task board for project management',
        created_by: createdUsers[0].id
      })
      .select()
      .single();

    if (!boardError && taskBoard) {
      // Create default lists
      const lists = [
        { name: 'To Do', position: 0 },
        { name: 'In Progress', position: 1 },
        { name: 'Done', position: 2 }
      ];

      for (const listData of lists) {
        await supabaseAdmin
          .from('task_lists')
          .insert({
            board_id: taskBoard.id,
            name: listData.name,
            position: listData.position
          });
      }

      // Create sample tasks
      const sampleTasks = [
        {
          title: 'Setup development environment',
          description: 'Install and configure all necessary tools',
          list_position: 0,
          assigned_to: createdUsers[1].id
        },
        {
          title: 'Design user interface',
          description: 'Create wireframes and mockups',
          list_position: 0,
          assigned_to: createdUsers[2].id
        },
        {
          title: 'Implement authentication',
          description: 'Set up user login and registration',
          list_position: 1,
          assigned_to: createdUsers[0].id
        }
      ];

      // Get the first list (To Do) to add tasks
      const { data: todoList, error: listError } = await supabaseAdmin
        .from('task_lists')
        .select('id')
        .eq('board_id', taskBoard.id)
        .eq('name', 'To Do')
        .single();

      if (!listError && todoList) {
        for (const taskData of sampleTasks) {
          await supabaseAdmin
            .from('tasks')
            .insert({
              list_id: todoList.id,
              title: taskData.title,
              description: taskData.description,
              position: taskData.list_position,
              assigned_to: taskData.assigned_to,
              created_by: createdUsers[0].id
            });
        }
      }

      console.log('✅ Created sample task board with tasks');
    }

    // Create sample document for first workspace
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({
        workspace_id: createdWorkspaces[0].id,
        title: 'Project Requirements',
        content: null,
        created_by: createdUsers[0].id,
        last_modified_by: createdUsers[0].id
      })
      .select()
      .single();

    if (!docError && document) {
      // Add all users as collaborators
      for (const user of createdUsers) {
        await supabaseAdmin
          .from('document_collaborators')
          .insert({
            document_id: document.id,
            user_id: user.id,
            permission: user.id === createdUsers[0].id ? 'admin' : 'write'
          });
      }

      console.log('✅ Created sample document with collaborators');
    }

    console.log('🎉 Database seeding completed successfully!');
    console.log('\n📋 Created:');
    console.log(`- ${createdUsers.length} users`);
    console.log(`- ${createdWorkspaces.length} workspaces`);
    console.log('- 1 task board with sample tasks');
    console.log('- 1 collaborative document');
    console.log('\n🔑 Test credentials:');
    console.log('Email: john.doe@example.com | Password: password123');
    console.log('Email: jane.smith@example.com | Password: password123');
    console.log('Email: mike.johnson@example.com | Password: password123');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}

module.exports = { seedDatabase };
